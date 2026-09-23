import {
  currentCatalogRelease,
  type RecipeAuthorityReadiness,
} from '../../../packages/recipes/src/recipe-authority';
import type { Env } from '../types';
import {
  RecipeAuthorityConfigError,
  recipeAuthorityCounters,
  resolveRecipeAuthority,
  resolveRecipeAuthorityConfig,
  type RecipeAuthorityEnv,
  type RecipeAuthorityMode,
} from './recipe-authority';

/**
 * T19C — machine-verifiable, PII-free recipe authority status (ADR-026).
 *
 * Two projections of ONE resolution:
 * - `publicRecipeAuthorityStatus`  → minimal, safe for the anonymous `/health/ready` body.
 * - `recipeAuthorityReleaseEvidence` → full release evidence for deploy automation; served only
 *   behind `RELEASE_VERIFY_TOKEN` (Worker secret) so no customer account is needed for certification.
 *
 * The evidence is computed with the SAME `resolveRecipeAuthority` the routes use, for a synthetic
 * tenant key that is never a real household. Canary and shadow release probes explicitly exercise
 * D1 while preserving the configured policy in the report. Nothing here contains household IDs,
 * emails, tokens, secrets, binding identifiers or recipe rows.
 */
export type RecipeAuthorityGlobalSource = 'static' | 'd1' | 'mixed';

export interface RecipeAuthorityPublicStatus {
  configuredMode: RecipeAuthorityMode | 'invalid';
  cutoverEnabled: boolean;
  canaryPercent: number;
  /** Source every non-canary request is served from (`mixed` while a canary is active). */
  globalSource: RecipeAuthorityGlobalSource;
  fallbackReason: string | null;
  releaseId: string;
  expectedRecipeCount: number;
}

export interface RecipeAuthorityReleaseEvidence extends RecipeAuthorityPublicStatus {
  schemaVersion: 1;
  environment: string;
  commit: string | null;
  checkedAt: string;
  /** Source the protected release probe actually resolved to. */
  actualSource: 'static' | 'd1';
  selectedSource: 'static' | 'd1';
  servedRecipeCount: number;
  servedFingerprint: string;
  expectedRuntimeFingerprint: string;
  /** `true` when the served snapshot is the reviewed release fingerprint (only possible from D1). */
  fingerprintMatchesRelease: boolean;
  d1Readiness: RecipeAuthorityReadiness['status'] | 'not_evaluated';
  d1ReadinessCode: string | null;
  counters: ReturnType<typeof recipeAuthorityCounters>;
}

const PROBE_TENANT_KEY = 'recipe-authority-release-probe';

function configOrInvalid(env: RecipeAuthorityEnv) {
  try {
    return { config: resolveRecipeAuthorityConfig(env), invalid: null as string | null };
  } catch (error) {
    return {
      config: null,
      invalid: error instanceof RecipeAuthorityConfigError ? error.code : 'INVALID_MODE',
    };
  }
}

function globalSourceOf(
  mode: RecipeAuthorityMode | 'invalid',
  canaryPercent: number,
  actualSource: 'static' | 'd1',
): RecipeAuthorityGlobalSource {
  if (mode === 'canary')
    return canaryPercent >= 100 ? actualSource : canaryPercent === 0 ? 'static' : 'mixed';
  return actualSource;
}

async function resolvePublicRecipeAuthorityStatus(env: RecipeAuthorityEnv) {
  const release = currentCatalogRelease();
  const { config, invalid } = configOrInvalid(env);
  if (!config) {
    return {
      status: {
        configuredMode: 'invalid',
        cutoverEnabled: false,
        canaryPercent: 0,
        globalSource: 'static',
        fallbackReason: invalid,
        releaseId: release.releaseId,
        expectedRecipeCount: release.expectedRecipeCount,
      } satisfies RecipeAuthorityPublicStatus,
      resolution: null,
    };
  }
  // A public canary summary must exercise the D1 path rather than accidentally probing an
  // out-of-cohort tenant and reporting a fabricated null fallback. The override is probe-local;
  // the configured percentage remains the reported policy and operator cohort secrets are ignored.
  const probeEnv: RecipeAuthorityEnv =
    config.mode === 'canary'
      ? {
          ...env,
          RECIPE_CATALOG_D1_CANARY_PERCENT: '100',
          RECIPE_CATALOG_TEST_COHORT_ENABLED: undefined,
          RECIPE_CATALOG_TEST_INCLUDE: undefined,
          RECIPE_CATALOG_TEST_EXCLUDE: undefined,
        }
      : env;
  const resolution = await resolveRecipeAuthority(probeEnv, {
    tenantKey: PROBE_TENANT_KEY,
    log: () => {},
  });
  return {
    status: {
      configuredMode: config.mode,
      cutoverEnabled: config.cutoverEnabled,
      canaryPercent: config.canaryPercent,
      globalSource: globalSourceOf(config.mode, config.canaryPercent, resolution.actualSource),
      fallbackReason: resolution.fallbackReason,
      releaseId: release.releaseId,
      expectedRecipeCount: release.expectedRecipeCount,
    } satisfies RecipeAuthorityPublicStatus,
    resolution,
  };
}

/** Sanitized status for the anonymous readiness body. Canary probes exercise D1 readiness. */
export async function publicRecipeAuthorityStatus(
  env: RecipeAuthorityEnv,
): Promise<RecipeAuthorityPublicStatus> {
  return (await resolvePublicRecipeAuthorityStatus(env)).status;
}

/**
 * Full release evidence for deploy automation. Canary probes resolve inside the cohort, while
 * shadow probes resolve through a probe-local D1 configuration. Both therefore prove D1 readiness
 * and the served D1 fingerprint without changing the configured policy reported in the evidence.
 */
export async function recipeAuthorityReleaseEvidence(
  env: Env,
  options: { now?: () => Date } = {},
): Promise<RecipeAuthorityReleaseEvidence> {
  const release = currentCatalogRelease();
  const resolved = await resolvePublicRecipeAuthorityStatus(env);
  const status = resolved.status;
  // Invalid deployment configuration still fails the protected proof rather than manufacturing
  // evidence from the invalid status projection.
  const publicResolution =
    resolved.resolution ??
    (await resolveRecipeAuthority(env, { tenantKey: PROBE_TENANT_KEY, log: () => {} }));
  const resolution =
    status.configuredMode === 'shadow'
      ? await resolveRecipeAuthority(
          {
            ...env,
            RECIPE_CATALOG_MODE: 'd1',
            RECIPE_CATALOG_CUTOVER_ENABLED: 'true',
            RECIPE_CATALOG_D1_CANARY_PERCENT: '0',
            RECIPE_CATALOG_TEST_COHORT_ENABLED: undefined,
            RECIPE_CATALOG_TEST_INCLUDE: undefined,
            RECIPE_CATALOG_TEST_EXCLUDE: undefined,
          },
          { tenantKey: PROBE_TENANT_KEY, log: () => {} },
        )
      : publicResolution;
  const notReady = resolution.diagnostics.find(
    (record) => record.event === 'recipe_catalog_d1_not_ready',
  );
  const stale = resolution.diagnostics.find(
    (record) => record.event === 'recipe_catalog_d1_stale_served',
  );
  const d1Selected = resolution.selectedSource === 'd1';
  return {
    schemaVersion: 1,
    environment: env.ENVIRONMENT || 'development',
    commit: env.GIT_COMMIT || null,
    checkedAt: (options.now?.() ?? new Date()).toISOString(),
    ...status,
    actualSource: resolution.actualSource,
    selectedSource: resolution.selectedSource,
    servedRecipeCount: resolution.snapshot.size,
    servedFingerprint: resolution.snapshot.fingerprint,
    expectedRuntimeFingerprint: release.expectedRuntimeFingerprint,
    fingerprintMatchesRelease:
      resolution.snapshot.fingerprint === release.expectedRuntimeFingerprint,
    d1Readiness: !d1Selected
      ? 'not_evaluated'
      : stale
        ? 'not_ready'
        : resolution.actualSource === 'd1'
        ? 'ready'
        : notReady
          ? 'not_ready'
          : 'error',
    d1ReadinessCode:
      d1Selected && (resolution.actualSource !== 'd1' || stale)
        ? (stale?.reasonCode ?? notReady?.reasonCode ?? resolution.fallbackReason)
        : null,
    fallbackReason:
      status.configuredMode === 'canary' || status.configuredMode === 'shadow'
        ? resolution.fallbackReason
        : status.fallbackReason,
    counters: recipeAuthorityCounters(),
  };
}

/** Constant-time comparison of two ASCII/UTF-8 secrets. */
export async function releaseVerifyTokenMatches(
  presented: string | undefined,
  expected: string | undefined,
): Promise<boolean> {
  if (!presented || !expected || expected.length < 32) return false;
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(presented)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ]);
  const left = new Uint8Array(a);
  const right = new Uint8Array(b);
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= left[index] ^ right[index];
  return diff === 0;
}
