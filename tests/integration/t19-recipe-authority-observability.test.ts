import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALL_RECIPES } from '../../packages/recipes/src/data';
import { currentCatalogRelease } from '../../packages/recipes/src/recipe-authority';
import { LEGACY_BASELINE_FINGERPRINT } from '../helpers/recipe-catalog-growth';
import { healthRoutes } from '../../src/worker/routes/health';
import {
  RECIPE_AUTHORITY_D1_TTL_MS,
  resetRecipeAuthorityCacheForTests,
  resetRecipeAuthorityCountersForTests,
} from '../../src/worker/services/recipe-authority';
import {
  recipeAuthorityReleaseEvidence,
  releaseVerifyTokenMatches,
} from '../../src/worker/services/recipe-authority-status';
import { resetRecipeCatalogShadowThrottle } from '../../src/worker/services/recipe-catalog-shadow';
import type { Env } from '../../src/worker/types';
import { verifyRecipeAuthorityEvidence } from '../../scripts/release-check.mjs';
import { SqliteD1 } from '../helpers/sqlite-d1';

/**
 * T19C/T19D — machine-verifiable recipe authority status.
 * Public readiness carries a minimal sanitized summary; the protected evidence endpoint carries the
 * full release proof that `release-check.mjs authority` consumes. Neither may expose PII or secrets.
 */
const TOKEN = 'release-verify-token-0123456789abcdef-long-enough';
const SECRETS: Partial<Env> = {
  RELEASE_VERIFY_TOKEN: TOKEN,
  JWT_SECRET: 'jwt_secret_do_not_leak_0123456789abcdef',
  OTP_HASH_SECRET: 'otp_secret_do_not_leak_0123456789abcdef',
  RESEND_API_KEY: 're_sk_do_not_leak_1234567890',
  TURNSTILE_SECRET_KEY: '0xturnstile_secret_do_not_leak',
};
// Operator cohort digests are legal only in canary mode with the cohort explicitly enabled.
const COHORT: Partial<Env> = {
  RECIPE_CATALOG_TEST_COHORT_ENABLED: 'true',
  RECIPE_CATALOG_TEST_INCLUDE: 'f'.repeat(64),
  RECIPE_CATALOG_TEST_EXCLUDE: 'e'.repeat(64),
};
const release = currentCatalogRelease();
const SHA = 'c'.repeat(40);

let db: SqliteD1;
const app = new Hono<{ Bindings: Env }>();
app.route('/api/v1', healthRoutes);
const env = (extra: Partial<Env> = {}): Env =>
  ({
    DB: db,
    ENVIRONMENT: 'production',
    GIT_COMMIT: SHA,
    APP_URL: 'https://frigo.example.com',
    ...SECRETS,
    ...extra,
  }) as unknown as Env;

beforeEach(() => {
  db = new SqliteD1();
  resetRecipeAuthorityCacheForTests();
  resetRecipeAuthorityCountersForTests();
  resetRecipeCatalogShadowThrottle();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  db.close();
  vi.useRealTimers();
  vi.restoreAllMocks();
  resetRecipeAuthorityCacheForTests();
});

const leakPattern =
  /do_not_leak|release-verify-token|RECIPE_CATALOG_TEST|ffffffffffff|eeeeeeeeeeee|household|@example|token_hash/i;

describe('public readiness recipeAuthority summary', () => {
  it.each([
    [
      {},
      {
        configuredMode: 'static',
        cutoverEnabled: false,
        canaryPercent: 0,
        globalSource: 'static',
        fallbackReason: null,
      },
    ],
    [
      { RECIPE_CATALOG_MODE: 'shadow' },
      {
        configuredMode: 'shadow',
        cutoverEnabled: false,
        canaryPercent: 0,
        globalSource: 'static',
        fallbackReason: null,
      },
    ],
    [
      {
        RECIPE_CATALOG_MODE: 'canary',
        RECIPE_CATALOG_CUTOVER_ENABLED: 'true',
        RECIPE_CATALOG_D1_CANARY_PERCENT: '5',
      },
      {
        configuredMode: 'canary',
        cutoverEnabled: true,
        canaryPercent: 5,
        globalSource: 'mixed',
        fallbackReason: null,
      },
    ],
    [
      { RECIPE_CATALOG_MODE: 'd1', RECIPE_CATALOG_CUTOVER_ENABLED: 'true' },
      {
        configuredMode: 'd1',
        cutoverEnabled: true,
        canaryPercent: 0,
        globalSource: 'd1',
        fallbackReason: null,
      },
    ],
    [
      { RECIPE_CATALOG_MODE: 'd1' },
      {
        configuredMode: 'invalid',
        cutoverEnabled: false,
        canaryPercent: 0,
        globalSource: 'static',
        fallbackReason: 'CUTOVER_NOT_ENABLED',
      },
    ],
  ] as const)('%o → %o', async (extra, expected) => {
    const response = await app.request('/api/v1/health/ready', {}, env(extra));
    const body = (await response.json()) as Record<string, any>;
    expect(body.recipeAuthority).toMatchObject({
      ...expected,
      releaseId: release.releaseId,
      expectedRecipeCount: release.expectedRecipeCount,
    });
    expect(JSON.stringify(body)).not.toMatch(leakPattern);
  });

  it('d1 with an unverifiable catalog reports the fallback truthfully in public readiness', async () => {
    db.seed("DELETE FROM recipe_steps WHERE recipe_id = 'vn-canh-01'");
    const response = await app.request(
      '/api/v1/health/ready',
      {},
      env({ RECIPE_CATALOG_MODE: 'd1', RECIPE_CATALOG_CUTOVER_ENABLED: 'true' }),
    );
    const body = (await response.json()) as Record<string, any>;
    expect(body.recipeAuthority).toMatchObject({
      configuredMode: 'd1',
      globalSource: 'static',
      fallbackReason: 'CATALOG_DIAGNOSTICS',
    });
  });

  it('canary readiness exercises an in-cohort probe and reports D1 fallback truthfully', async () => {
    db.seed("DELETE FROM recipe_steps WHERE recipe_id = 'vn-canh-01'");
    const response = await app.request(
      '/api/v1/health/ready',
      {},
      env({
        RECIPE_CATALOG_MODE: 'canary',
        RECIPE_CATALOG_CUTOVER_ENABLED: 'true',
        RECIPE_CATALOG_D1_CANARY_PERCENT: '1',
      }),
    );
    const body = (await response.json()) as Record<string, any>;
    expect(body.recipeAuthority).toMatchObject({
      configuredMode: 'canary',
      canaryPercent: 1,
      globalSource: 'mixed',
      fallbackReason: 'CATALOG_DIAGNOSTICS',
    });
    expect(JSON.stringify(body)).not.toMatch(leakPattern);
  });
});

describe('protected release evidence endpoint', () => {
  it('is absent (404) without the RELEASE_VERIFY_TOKEN secret and 401 for wrong/short/missing bearer tokens', async () => {
    expect(
      (
        await app.request(
          '/api/v1/health/recipe-authority',
          { headers: { Authorization: `Bearer ${TOKEN}` } },
          env({ RELEASE_VERIFY_TOKEN: undefined }),
        )
      ).status,
    ).toBe(404);
    expect((await app.request('/api/v1/health/recipe-authority', {}, env())).status).toBe(401);
    expect(
      (
        await app.request(
          '/api/v1/health/recipe-authority',
          { headers: { Authorization: 'Bearer nope' } },
          env(),
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await app.request(
          '/api/v1/health/recipe-authority',
          { headers: { Authorization: `Bearer ${TOKEN}x` } },
          env(),
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await app.request(
          '/api/v1/health/recipe-authority',
          { headers: { Authorization: TOKEN } },
          env(),
        )
      ).status,
    ).toBe(401);
    // A short configured secret never authorizes anything.
    expect(
      (
        await app.request(
          '/api/v1/health/recipe-authority',
          { headers: { Authorization: 'Bearer short' } },
          env({ RELEASE_VERIFY_TOKEN: 'short' }),
        )
      ).status,
    ).toBe(401);
    expect(await releaseVerifyTokenMatches(TOKEN, TOKEN)).toBe(true);
    expect(await releaseVerifyTokenMatches(TOKEN.toUpperCase(), TOKEN)).toBe(false);
  });

  it.each([
    ['static', {}, 'static', 71, LEGACY_BASELINE_FINGERPRINT, 'not_evaluated'],
    [
      'shadow',
      { RECIPE_CATALOG_MODE: 'shadow' },
      'd1',
      release.expectedRecipeCount,
      release.expectedRuntimeFingerprint,
      'ready',
    ],
    [
      'canary 5',
      {
        RECIPE_CATALOG_MODE: 'canary',
        RECIPE_CATALOG_CUTOVER_ENABLED: 'true',
        RECIPE_CATALOG_D1_CANARY_PERCENT: '5',
      },
      'd1',
      release.expectedRecipeCount,
      release.expectedRuntimeFingerprint,
      'ready',
    ],
    [
      'd1',
      { RECIPE_CATALOG_MODE: 'd1', RECIPE_CATALOG_CUTOVER_ENABLED: 'true' },
      'd1',
      release.expectedRecipeCount,
      release.expectedRuntimeFingerprint,
      'ready',
    ],
  ] as const)(
    '%s: evidence is complete, PII-free, and passes the release-check proof for its approved manifest',
    async (_label, extra, actualSource, served, fingerprint, readiness) => {
      const response = await app.request(
        '/api/v1/health/recipe-authority',
        { headers: { Authorization: `Bearer ${TOKEN}` } },
        env(extra),
      );
      expect(response.status).toBe(200);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      const evidence = (await response.json()) as Record<string, any>;
      expect(evidence).toMatchObject({
        schemaVersion: 1,
        environment: 'production',
        commit: SHA,
        actualSource,
        servedRecipeCount: served,
        servedFingerprint: fingerprint,
        d1Readiness: readiness,
        fallbackReason: null,
        releaseId: release.releaseId,
        expectedRecipeCount: release.expectedRecipeCount,
        expectedRuntimeFingerprint: release.expectedRuntimeFingerprint,
      });
      expect(evidence.fingerprintMatchesRelease).toBe(actualSource === 'd1');
      expect(JSON.stringify(evidence)).not.toMatch(leakPattern);
      expect(Object.keys(evidence).sort()).toEqual([
        'actualSource',
        'canaryPercent',
        'checkedAt',
        'commit',
        'configuredMode',
        'counters',
        'cutoverEnabled',
        'd1Readiness',
        'd1ReadinessCode',
        'environment',
        'expectedRecipeCount',
        'expectedRuntimeFingerprint',
        'fallbackReason',
        'fingerprintMatchesRelease',
        'globalSource',
        'releaseId',
        'schemaVersion',
        'selectedSource',
        'servedFingerprint',
        'servedRecipeCount',
      ]);
      const mode = (extra as Record<string, string>).RECIPE_CATALOG_MODE ?? 'static';
      const manifest = {
        sha: SHA,
        environment: 'production',
        recipeCatalogMode: mode,
        recipeCatalogCanaryPercent: mode === 'canary' ? 5 : 0,
        recipeCatalogCutoverEnabled: mode === 'canary' || mode === 'd1',
      };
      expect(verifyRecipeAuthorityEvidence(manifest, evidence, release)).toMatchObject({
        configuredMode: mode,
        actualSource,
        servedRecipeCount: served,
      });
      // The same evidence must NOT certify a different approved state.
      const other = {
        ...manifest,
        recipeCatalogMode: mode === 'd1' ? 'shadow' : 'd1',
        recipeCatalogCutoverEnabled: mode !== 'd1',
        recipeCatalogCanaryPercent: 0,
      };
      expect(() => verifyRecipeAuthorityEvidence(other, evidence, release)).toThrow();
    },
  );

  it('d1 with D1 readiness failure: evidence names the fallback and the release proof refuses it (HOLD/ROLLBACK signal)', async () => {
    db.seed(`INSERT INTO recipes (id, slug, title, description, cuisine, cook_time_minutes, servings, difficulty, image_url, tags, source_type, source_reference, verification_state, version)
      VALUES ('imp-ffffffffffffffff', 'stray-extra', 'Stray', 'Stray extra row', 'thai', 10, 2, 'easy', '/frigo/illustrations/delicious-meal.png', '[]', 'ai_generated', 'stray', 'reviewed', 1);
      INSERT INTO recipe_ingredients (id, recipe_id, ingredient_id, name, required_quantity, unit, is_optional) VALUES ('imp-ffffffffffffffff_ing_1', 'imp-ffffffffffffffff', 'RICE', 'Gạo', 100, 'g', 0);
      INSERT INTO recipe_runtime_ingredient_order (recipe_ingredient_id, recipe_id, position) VALUES ('imp-ffffffffffffffff_ing_1', 'imp-ffffffffffffffff', 0);
      INSERT INTO recipe_steps (id, recipe_id, step_number, instruction) VALUES ('imp-ffffffffffffffff_step_1', 'imp-ffffffffffffffff', 1, 'Stray step');
      INSERT INTO recipe_runtime_fields (recipe_id, runtime_order) VALUES ('imp-ffffffffffffffff', ${release.expectedRecipeCount});`);
    const evidence = await recipeAuthorityReleaseEvidence(
      env({ RECIPE_CATALOG_MODE: 'd1', RECIPE_CATALOG_CUTOVER_ENABLED: 'true' }),
    );
    expect(evidence).toMatchObject({
      configuredMode: 'd1',
      selectedSource: 'd1',
      actualSource: 'static',
      globalSource: 'static',
      fallbackReason: 'COUNT_DRIFT',
      d1Readiness: 'not_ready',
      d1ReadinessCode: 'COUNT_DRIFT',
      servedRecipeCount: ALL_RECIPES.length,
    });
    const manifest = {
      sha: SHA,
      environment: 'production',
      recipeCatalogMode: 'd1',
      recipeCatalogCanaryPercent: 0,
      recipeCatalogCutoverEnabled: true,
    };
    expect(() => verifyRecipeAuthorityEvidence(manifest, evidence, release)).toThrow(
      /actualSource "static" != "d1".*fallbackReason "COUNT_DRIFT" != null/,
    );
  });

  it('shadow evidence actively probes D1 and refuses promotion when that probe falls back', async () => {
    db.seed("DELETE FROM recipe_steps WHERE recipe_id = 'vn-canh-01'");
    const evidence = await recipeAuthorityReleaseEvidence(env({ RECIPE_CATALOG_MODE: 'shadow' }));
    expect(evidence).toMatchObject({
      configuredMode: 'shadow',
      selectedSource: 'd1',
      actualSource: 'static',
      globalSource: 'static',
      fallbackReason: 'CATALOG_DIAGNOSTICS',
      d1Readiness: 'not_ready',
      d1ReadinessCode: 'CATALOG_DIAGNOSTICS',
      servedRecipeCount: ALL_RECIPES.length,
    });
    const manifest = {
      sha: SHA,
      environment: 'production',
      recipeCatalogMode: 'shadow',
      recipeCatalogCanaryPercent: 0,
      recipeCatalogCutoverEnabled: false,
    };
    expect(() => verifyRecipeAuthorityEvidence(manifest, evidence, release)).toThrow(
      /actualSource.*fallbackReason.*d1Readiness/,
    );
  });

  it('refuses release proof while a stale verified D1 snapshot is serving after refresh failure', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-22T12:00:00.000Z'));
    const config = { RECIPE_CATALOG_MODE: 'd1', RECIPE_CATALOG_CUTOVER_ENABLED: 'true' } as const;
    const fresh = await recipeAuthorityReleaseEvidence(env(config));
    expect(fresh.d1Readiness).toBe('ready');

    vi.advanceTimersByTime(RECIPE_AUTHORITY_D1_TTL_MS + 1);
    const brokenDb = {
      prepare() {
        throw new Error('D1 unavailable');
      },
      batch() {
        return Promise.reject(new Error('D1 unavailable'));
      },
    } as unknown as Env['DB'];
    const stale = await recipeAuthorityReleaseEvidence(env({ ...config, DB: brokenDb }));
    expect(stale).toMatchObject({
      selectedSource: 'd1',
      actualSource: 'd1',
      d1Readiness: 'not_ready',
      d1ReadinessCode: 'D1_READ_FAILED',
      fallbackReason: null,
      servedFingerprint: fresh.servedFingerprint,
    });
    expect(() =>
      verifyRecipeAuthorityEvidence(
        {
          sha: SHA,
          environment: 'production',
          recipeCatalogMode: 'd1',
          recipeCatalogCanaryPercent: 0,
          recipeCatalogCutoverEnabled: true,
        },
        stale,
        release,
      ),
    ).toThrow(/d1Readiness/);
  });

  it('canary evidence exercises D1 readiness for the probe without changing the configured percent or consulting the operator cohort', async () => {
    const evidence = await recipeAuthorityReleaseEvidence(
      env({
        RECIPE_CATALOG_MODE: 'canary',
        RECIPE_CATALOG_CUTOVER_ENABLED: 'true',
        RECIPE_CATALOG_D1_CANARY_PERCENT: '1',
        ...COHORT,
      }),
    );
    expect(evidence).toMatchObject({
      configuredMode: 'canary',
      canaryPercent: 1,
      globalSource: 'mixed',
      actualSource: 'd1',
      d1Readiness: 'ready',
      servedRecipeCount: release.expectedRecipeCount,
    });
    expect(evidence.counters.authorizedInclude + evidence.counters.authorizedExclude).toBe(0);
    expect(JSON.stringify(evidence)).not.toMatch(leakPattern);
  });
});
