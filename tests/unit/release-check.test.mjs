import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  RELEASE_PROPAGATION_PENDING,
  migrationManifest,
  requireSuccessfulCi,
  validateRecipeCatalogManifestPolicy,
  validateRecipeCatalogMode,
  validateRecipeCatalogRollout,
  validateRecipeCatalogTransition,
  validateReleaseSource,
  verifyDeployedRelease,
  verifyMigrationLedger,
  verifyRecipeAuthorityEvidence,
  verifyRecipeCatalogRollback,
  verifyDeployedWorker,
  verifyRollbackTarget,
  verifyStableWorkerDeployment,
  verifyWorkerD1Binding,
} from '../../scripts/release-check.mjs';

const repository = 'release-fixture/Frigo';
const goodSha = 'a'.repeat(40);
const successful = {
  id: 2,
  run_attempt: 1,
  head_sha: goodSha,
  head_branch: 'main',
  event: 'push',
  path: '.github/workflows/ci.yml',
  status: 'completed',
  conclusion: 'success',
  repository: { full_name: repository },
  head_repository: { full_name: repository },
  html_url: 'https://github.com/release-fixture/Frigo/actions/runs/2',
};

describe('recipe catalog rollout mode validation (T19B release state machine)', () => {
  it.each(['static', 'shadow', 'canary', 'd1'])('accepts the reviewed %s state', (mode) => {
    expect(validateRecipeCatalogMode(mode)).toBe(mode);
  });

  it.each([undefined, '', 'full', 'full_d1', 'SHADOW', 'D1', 'static '])(
    'rejects unreviewed mode %s',
    (mode) => {
      expect(() => validateRecipeCatalogMode(mode)).toThrow(
        'must be static, shadow, canary, or d1',
      );
    },
  );

  it.each([
    ['static', '0', false],
    ['shadow', '0', false],
    ['canary', '1', true],
    ['canary', '2', true],
    ['canary', '5', true],
    ['canary', '25', true],
    ['d1', '0', true],
  ])(
    '%s/%s derives the reviewed immutable policy (cutover is derived, never an input)',
    (mode, canaryPercent, cutoverEnabled) => {
      expect(validateRecipeCatalogRollout({ mode, canaryPercent })).toEqual({
        mode,
        canaryPercent: Number(canaryPercent),
        cutoverEnabled,
      });
    },
  );

  it.each([
    ['static', '1'],
    ['static', '5'],
    ['shadow', '1'],
    ['shadow', '25'],
    ['canary', '0'],
    ['canary', '10'],
    ['canary', '50'],
    ['canary', '100'],
    ['d1', '1'],
    ['d1', '5'],
    ['d1', '25'],
    ['d1', '100'],
    ['full', '1'],
    ['canary', '05'],
    ['canary', '1.0'],
    ['canary', '-1'],
    ['canary', '1e0'],
    ['canary', '025'],
  ])('rejects contradictory rollout state %s/%s', (mode, canaryPercent) => {
    expect(() => validateRecipeCatalogRollout({ mode, canaryPercent })).toThrow();
  });

  it('revalidates every rollout field from the immutable release manifest', () => {
    expect(
      validateRecipeCatalogManifestPolicy({
        recipeCatalogMode: 'canary',
        recipeCatalogCanaryPercent: 2,
        recipeCatalogCutoverEnabled: true,
      }),
    ).toEqual({ mode: 'canary', canaryPercent: 2, cutoverEnabled: true });
    expect(
      validateRecipeCatalogManifestPolicy({
        recipeCatalogMode: 'd1',
        recipeCatalogCanaryPercent: 0,
        recipeCatalogCutoverEnabled: true,
      }),
    ).toEqual({ mode: 'd1', canaryPercent: 0, cutoverEnabled: true });
    expect(
      validateRecipeCatalogManifestPolicy({
        recipeCatalogMode: 'shadow',
        recipeCatalogCanaryPercent: 0,
        recipeCatalogCutoverEnabled: false,
      }),
    ).toEqual({ mode: 'shadow', canaryPercent: 0, cutoverEnabled: false });
    // A manifest whose cutover flag disagrees with its mode was tampered with or hand-written.
    expect(() =>
      validateRecipeCatalogManifestPolicy({
        recipeCatalogMode: 'canary',
        recipeCatalogCanaryPercent: 2,
        recipeCatalogCutoverEnabled: false,
      }),
    ).toThrow('cutover policy');
    expect(() =>
      validateRecipeCatalogManifestPolicy({
        recipeCatalogMode: 'd1',
        recipeCatalogCanaryPercent: 0,
        recipeCatalogCutoverEnabled: false,
      }),
    ).toThrow('cutover policy');
    expect(() =>
      validateRecipeCatalogManifestPolicy({
        recipeCatalogMode: 'shadow',
        recipeCatalogCanaryPercent: 0,
        recipeCatalogCutoverEnabled: true,
      }),
    ).toThrow('cutover policy');
    expect(() =>
      validateRecipeCatalogManifestPolicy({
        recipeCatalogMode: 'd1',
        recipeCatalogCanaryPercent: 1,
        recipeCatalogCutoverEnabled: true,
      }),
    ).toThrow();
    expect(() =>
      validateRecipeCatalogManifestPolicy({
        recipeCatalogMode: 'canary',
        recipeCatalogCanaryPercent: 100,
        recipeCatalogCutoverEnabled: true,
      }),
    ).toThrow();
  });
});

describe('T19D post-deploy recipe authority proof', () => {
  const release = {
    releaseId: 'rel-test',
    legacyBaselineCount: 71,
    expectedRecipeCount: 500,
    legacyBaselineFingerprint: 'a'.repeat(64),
    expectedRuntimeFingerprint: 'b'.repeat(64),
  };
  const base = { sha: goodSha, environment: 'production' };
  const evidenceFor = (mode, overrides = {}) => {
    const d1Probe = mode !== 'static';
    return {
      schemaVersion: 1,
      environment: 'production',
      commit: goodSha,
      checkedAt: '2026-09-22T00:00:00.000Z',
      configuredMode: mode,
      cutoverEnabled: mode === 'canary' || mode === 'd1',
      canaryPercent: mode === 'canary' ? 5 : 0,
      globalSource: mode === 'd1' ? 'd1' : mode === 'canary' ? 'mixed' : 'static',
      releaseId: 'rel-test',
      expectedRecipeCount: 500,
      selectedSource: d1Probe ? 'd1' : 'static',
      actualSource: d1Probe ? 'd1' : 'static',
      servedRecipeCount: d1Probe ? 500 : 71,
      servedFingerprint: d1Probe ? 'b'.repeat(64) : 'a'.repeat(64),
      expectedRuntimeFingerprint: 'b'.repeat(64),
      fingerprintMatchesRelease: d1Probe,
      d1Readiness: d1Probe ? 'ready' : 'not_evaluated',
      d1ReadinessCode: null,
      fallbackReason: null,
      counters: {},
      ...overrides,
    };
  };
  // Manifests the reviewed gate would produce; each one passes the same policy revalidation `recheck` runs.
  const manifestFor = (mode) => {
    const manifest = {
      ...base,
      recipeCatalogMode: mode,
      recipeCatalogCanaryPercent: mode === 'canary' ? 5 : 0,
      recipeCatalogCutoverEnabled: mode === 'canary' || mode === 'd1',
    };
    validateRecipeCatalogManifestPolicy(manifest);
    return manifest;
  };

  it.each(['static', 'shadow', 'canary', 'd1'])(
    '%s: the Worker must echo the approved state and serve exactly what it promises',
    (mode) => {
      const proof = verifyRecipeAuthorityEvidence(manifestFor(mode), evidenceFor(mode), release);
      expect(proof).toMatchObject({
        configuredMode: mode,
        fallbackReason: null,
        releaseId: 'rel-test',
      });
      expect(proof.servedRecipeCount).toBe(mode === 'static' ? 71 : 500);
    },
  );

  it('d1: a D1 fallback (static actually served) is a failure, never a pass', () => {
    const fallback = evidenceFor('d1', {
      actualSource: 'static',
      fallbackReason: 'COUNT_DRIFT',
      d1Readiness: 'not_ready',
      d1ReadinessCode: 'COUNT_DRIFT',
      servedRecipeCount: 71,
      servedFingerprint: 'a'.repeat(64),
      fingerprintMatchesRelease: false,
      globalSource: 'static',
    });
    expect(() => verifyRecipeAuthorityEvidence(manifestFor('d1'), fallback, release)).toThrow(
      /actualSource.*fallbackReason.*d1Readiness/,
    );
  });

  it('d1: a served fingerprint or count that is not the reviewed release fails', () => {
    expect(() =>
      verifyRecipeAuthorityEvidence(
        manifestFor('d1'),
        evidenceFor('d1', { servedRecipeCount: 499 }),
        release,
      ),
    ).toThrow('servedRecipeCount');
    expect(() =>
      verifyRecipeAuthorityEvidence(
        manifestFor('d1'),
        evidenceFor('d1', { servedFingerprint: 'c'.repeat(64), fingerprintMatchesRelease: false }),
        release,
      ),
    ).toThrow('servedFingerprint');
  });

  it('rejects a Worker that reports a different mode, percent, cutover, commit, environment or release than approved', () => {
    expect(() =>
      verifyRecipeAuthorityEvidence(manifestFor('d1'), evidenceFor('shadow'), release),
    ).toThrow('configuredMode');
    expect(() =>
      verifyRecipeAuthorityEvidence(
        manifestFor('canary'),
        evidenceFor('canary', { canaryPercent: 25 }),
        release,
      ),
    ).toThrow('canaryPercent');
    expect(() =>
      verifyRecipeAuthorityEvidence(
        manifestFor('canary'),
        evidenceFor('canary', { cutoverEnabled: false }),
        release,
      ),
    ).toThrow('cutoverEnabled');
    expect(() =>
      verifyRecipeAuthorityEvidence(
        manifestFor('static'),
        evidenceFor('static', { commit: 'b'.repeat(40) }),
        release,
      ),
    ).toThrow('commit');
    expect(() =>
      verifyRecipeAuthorityEvidence(
        manifestFor('static'),
        evidenceFor('static', { environment: 'staging' }),
        release,
      ),
    ).toThrow('environment');
    expect(() =>
      verifyRecipeAuthorityEvidence(
        manifestFor('static'),
        evidenceFor('static', { releaseId: 'rel-other' }),
        release,
      ),
    ).toThrow('releaseId');
    expect(() =>
      verifyRecipeAuthorityEvidence(
        manifestFor('static'),
        evidenceFor('static', { expectedRecipeCount: 71 }),
        release,
      ),
    ).toThrow('expectedRecipeCount');
  });

  it('static rejects D1 content and shadow rejects a missing D1 readiness proof', () => {
    expect(() =>
      verifyRecipeAuthorityEvidence(
        manifestFor('static'),
        evidenceFor('static', { actualSource: 'd1' }),
        release,
      ),
    ).toThrow('actualSource');
    expect(() =>
      verifyRecipeAuthorityEvidence(
        manifestFor('shadow'),
        evidenceFor('shadow', {
          selectedSource: 'static',
          actualSource: 'static',
          servedRecipeCount: 71,
          servedFingerprint: 'a'.repeat(64),
          fingerprintMatchesRelease: false,
          d1Readiness: 'not_evaluated',
        }),
        release,
      ),
    ).toThrow(/selectedSource.*actualSource.*d1Readiness/);
  });

  it('non-object or unknown-schema evidence fails closed', () => {
    for (const body of [null, undefined, 'ok', 42])
      expect(() => verifyRecipeAuthorityEvidence(manifestFor('static'), body, release)).toThrow(
        'not an object',
      );
    expect(() =>
      verifyRecipeAuthorityEvidence(
        manifestFor('static'),
        { ...evidenceFor('static'), schemaVersion: 2 },
        release,
      ),
    ).toThrow('schema');
  });
});

describe('T19 production transition and rollback safety', () => {
  const release = {
    releaseId: 'rel-test',
    legacyBaselineCount: 71,
    expectedRecipeCount: 500,
    legacyBaselineFingerprint: 'a'.repeat(64),
    expectedRuntimeFingerprint: 'b'.repeat(64),
  };
  const evidence = (mode, percent = 0, overrides = {}) => ({
    schemaVersion: 1,
    environment: 'production',
    commit: goodSha,
    configuredMode: mode,
    canaryPercent: percent,
    cutoverEnabled: mode === 'canary' || mode === 'd1',
    globalSource: mode === 'd1' ? 'd1' : mode === 'canary' ? 'mixed' : 'static',
    releaseId: release.releaseId,
    expectedRecipeCount: release.expectedRecipeCount,
    selectedSource: mode === 'static' ? 'static' : 'd1',
    actualSource: mode === 'static' ? 'static' : 'd1',
    servedRecipeCount: mode === 'static' ? 71 : 500,
    servedFingerprint: mode === 'static' ? 'a'.repeat(64) : 'b'.repeat(64),
    expectedRuntimeFingerprint: 'b'.repeat(64),
    fingerprintMatchesRelease: mode !== 'static',
    d1Readiness: mode === 'static' ? 'not_evaluated' : 'ready',
    d1ReadinessCode: null,
    fallbackReason: null,
    ...overrides,
  });
  const target = (mode, percent = 0, overrides = {}) => ({
    sha: goodSha,
    environment: 'production',
    recipeCatalogMode: mode,
    recipeCatalogCanaryPercent: percent,
    recipeCatalogCutoverEnabled: mode === 'canary' || mode === 'd1',
    recipeCatalogRollbackConfirmed: false,
    ...overrides,
  });
  const forwardFromGoodSha = {
    isAncestor: (ancestor, descendant) => ancestor === goodSha && descendant === 'b'.repeat(40),
  };
  const workerVersion = (id = 'version-1', bindings = undefined) => ({
    id,
    resources: {
      bindings: bindings ?? [{ type: 'd1', name: 'DB', id: 'f975ec39-b2c8-4a2a-80e1-0366054599d3' }],
    },
  });

  it.each([
    ['static', 0, 'shadow', 0],
    ['shadow', 0, 'canary', 1],
    ['canary', 1, 'canary', 2],
    ['canary', 1, 'canary', 5],
    ['canary', 2, 'canary', 5],
    ['canary', 5, 'canary', 25],
    ['canary', 25, 'd1', 0],
  ])('allows reviewed progression %s/%s -> %s/%s', (fromMode, fromPercent, toMode, toPercent) => {
    expect(
      validateRecipeCatalogTransition(
        target(toMode, toPercent),
        evidence(fromMode, fromPercent),
        release,
      ).kind,
    ).toBe(fromMode === 'static' ? 'release_start' : 'promotion');
  });

  it.each([
    ['shadow', 0, 'canary', 5],
    ['canary', 1, 'canary', 25],
    ['canary', 25, 'canary', 5],
    ['d1', 0, 'canary', 25],
  ])(
    'rejects skipped, stale, or reverse transition %s/%s -> %s/%s',
    (fromMode, fromPercent, toMode, toPercent) => {
      expect(() =>
        validateRecipeCatalogTransition(
          target(toMode, toPercent),
          evidence(fromMode, fromPercent),
          release,
        ),
      ).toThrow(/transition|rollback/);
    },
  );

  it('requires explicit rollback confirmation so a stale queued dispatch cannot downgrade authority', () => {
    expect(() =>
      validateRecipeCatalogTransition(target('shadow'), evidence('d1'), release),
    ).toThrow('explicit confirmation');
    expect(
      validateRecipeCatalogTransition(
        target('shadow', 0, { recipeCatalogRollbackConfirmed: true }),
        evidence('d1'),
        release,
      ),
    ).toMatchObject({ kind: 'rollback', from: 'd1', to: 'shadow' });
  });

  it('requires a new release SHA to restart at shadow and permits only safe endpoint bootstrap', () => {
    const next = 'b'.repeat(40);
    expect(() =>
      validateRecipeCatalogTransition(
        target('canary', 1, { sha: next }),
        evidence('shadow'),
        release,
        forwardFromGoodSha,
      ),
    ).toThrow('restart');
    expect(
      validateRecipeCatalogTransition(
        target('shadow', 0, { sha: next }),
        evidence('shadow'),
        release,
        forwardFromGoodSha,
      ).kind,
    ).toBe('release_start');
    expect(
      validateRecipeCatalogTransition(
        target('shadow', 0, { sha: next }),
        evidence('static'),
        release,
        forwardFromGoodSha,
      ).kind,
    ).toBe('release_start');
    expect(
      validateRecipeCatalogTransition(
        target('shadow', 0, { recipeCatalogRollbackConfirmed: true }),
        { unavailable: true, httpStatus: 404 },
        release,
      ).kind,
    ).toBe('bootstrap');
    expect(() =>
      validateRecipeCatalogTransition(
        target('shadow'),
        { unavailable: true, httpStatus: 404 },
        release,
      ),
    ).toThrow('explicit rollback/bootstrap confirmation');
    expect(() =>
      validateRecipeCatalogTransition(
        target('canary', 1),
        { unavailable: true, httpStatus: 404 },
        release,
      ),
    ).toThrow('bootstrap');
  });

  it('rejects an older queued SHA even when authority remains static or shadow', () => {
    const older = 'b'.repeat(40);
    const deployedNewer = evidence('shadow', 0, { commit: goodSha });
    expect(() =>
      validateRecipeCatalogTransition(target('shadow', 0, { sha: older }), deployedNewer, release, {
        isAncestor: () => false,
      }),
    ).toThrow('backwards');
    expect(() =>
      validateRecipeCatalogTransition(
        target('static', 0, { sha: older }),
        evidence('static'),
        release,
        { isAncestor: () => false },
      ),
    ).toThrow('backwards');
  });

  it('blocks shadow promotion unless its protected probe proves healthy D1', () => {
    expect(() =>
      validateRecipeCatalogTransition(
        target('canary', 1),
        evidence('shadow', 0, {
          selectedSource: 'static',
          actualSource: 'static',
          d1Readiness: 'not_evaluated',
          servedRecipeCount: 71,
          servedFingerprint: 'a'.repeat(64),
          fingerprintMatchesRelease: false,
        }),
        release,
      ),
    ).toThrow(/selectedSource|d1Readiness/);
  });

  it('blocks promotion from unhealthy authority evidence', () => {
    expect(() =>
      validateRecipeCatalogTransition(
        target('d1'),
        evidence('canary', 25, {
          actualSource: 'static',
          d1Readiness: 'not_ready',
          fallbackReason: 'COUNT_DRIFT',
          servedRecipeCount: 71,
          servedFingerprint: 'a'.repeat(64),
          fingerprintMatchesRelease: false,
        }),
        release,
      ),
    ).toThrow(/actualSource|fallbackReason/);
  });

  it('pins one previous 100% Worker version and proves exact-version authority rollback', () => {
    const previousDeployment = {
      id: 'deployment-before',
      versions: [{ version_id: 'version-1', percentage: 100 }],
    };
    expect(verifyStableWorkerDeployment(previousDeployment)).toMatchObject({
      versionId: 'version-1',
      deploymentId: 'deployment-before',
    });
    expect(() =>
      verifyStableWorkerDeployment({
        versions: [
          { version_id: 'one', percentage: 50 },
          { version_id: 'two', percentage: 50 },
        ],
      }),
    ).toThrow('exactly one');
    const previous = evidence('shadow');
    const manifest = {
      cloudflare: { databaseName: 'frigo-db', databaseId: 'f975ec39-b2c8-4a2a-80e1-0366054599d3' },
      previousDeployment: { versionId: 'version-1', deploymentId: 'deployment-before' },
      deployedWorker: { deploymentId: 'deployment-candidate' },
      previousRecipeAuthority: previous,
    };
    expect(verifyRollbackTarget(manifest, workerVersion())).toMatchObject({
      versionId: 'version-1',
      bindingName: 'DB',
    });
    const deployment = {
      id: 'deployment-rollback',
      versions: [{ version_id: 'version-1', percentage: 100 }],
    };
    expect(
      verifyRecipeCatalogRollback(
        manifest,
        deployment,
        { ...previous, checkedAt: 'later' },
        workerVersion(),
        { versionId: 'version-1', deploymentId: 'deployment-rollback' },
      ),
    ).toMatchObject({
      result: 'restored',
      versionId: 'version-1',
      deploymentId: 'deployment-rollback',
    });
    expect(() =>
      verifyRecipeCatalogRollback(
        manifest,
        {
          id: 'deployment-wrong',
          versions: [{ version_id: 'version-2', percentage: 100 }],
        },
        previous,
        workerVersion('version-2'),
        { versionId: 'version-2', deploymentId: 'deployment-wrong' },
      ),
    ).toThrow('exact previous');
  });

  it('requires one exact D1 binding on both the rollback target and deployed 100% version', () => {
    expect(verifyWorkerD1Binding(workerVersion())).toMatchObject({
      versionId: 'version-1',
      bindingName: 'DB',
      databaseId: 'f975ec39-b2c8-4a2a-80e1-0366054599d3',
    });
    for (const bindings of [
      [],
      [{ type: 'd1', name: 'OTHER', id: 'f975ec39-b2c8-4a2a-80e1-0366054599d3' }],
      [{ type: 'd1', name: 'DB', id: 'wrong-id' }],
      [
        { type: 'd1', name: 'DB', id: 'f975ec39-b2c8-4a2a-80e1-0366054599d3' },
        { type: 'd1', name: 'OTHER', id: 'other-id' },
      ],
    ]) {
      expect(() => verifyWorkerD1Binding(workerVersion('version-1', bindings))).toThrow(
        'pinned production database',
      );
    }

    const manifest = {
      cloudflare: { databaseName: 'frigo-db', databaseId: 'f975ec39-b2c8-4a2a-80e1-0366054599d3' },
      previousDeployment: { versionId: 'version-1', deploymentId: 'deployment-before' },
    };
    expect(
      verifyDeployedWorker(
        manifest,
        {
          id: 'deployment-candidate',
          versions: [{ version_id: 'version-2', percentage: 100 }],
        },
        workerVersion('version-2'),
      ),
    ).toMatchObject({
      versionId: 'version-2',
      deploymentId: 'deployment-candidate',
      binding: { bindingName: 'DB', databaseId: 'f975ec39-b2c8-4a2a-80e1-0366054599d3' },
    });
  });

  it.each([
    'schemaVersion',
    'environment',
    'commit',
    'configuredMode',
    'cutoverEnabled',
    'canaryPercent',
    'globalSource',
    'releaseId',
    'expectedRecipeCount',
    'selectedSource',
    'actualSource',
    'servedRecipeCount',
    'servedFingerprint',
    'expectedRuntimeFingerprint',
    'fingerprintMatchesRelease',
    'd1Readiness',
    'd1ReadinessCode',
    'fallbackReason',
  ])('rejects rollback evidence that differs at %s', (field) => {
    const deployment = {
      id: 'deployment-rollback',
      versions: [{ version_id: 'version-1', percentage: 100 }],
    };
    const previous = evidence('shadow');
    const manifest = {
      previousDeployment: { versionId: 'version-1', deploymentId: 'deployment-before' },
      previousRecipeAuthority: previous,
    };
    expect(() =>
      verifyRecipeCatalogRollback(
        manifest,
        deployment,
        {
          ...previous,
          [field]: `changed-${field}`,
        },
        workerVersion(),
        { versionId: 'version-1', deploymentId: 'deployment-rollback' },
      ),
    ).toThrow(`differs at ${field}`);
  });

  it('rejects an incomplete previous authority snapshot instead of proving a partial rollback', () => {
    const previous = evidence('shadow');
    delete previous.expectedRecipeCount;
    expect(() =>
      verifyRecipeCatalogRollback(
        {
          previousDeployment: { versionId: 'version-1', deploymentId: 'deployment-before' },
          previousRecipeAuthority: previous,
        },
        {
          id: 'deployment-rollback',
          versions: [{ version_id: 'version-1', percentage: 100 }],
        },
        previous,
        workerVersion(),
        { versionId: 'version-1', deploymentId: 'deployment-rollback' },
      ),
    ).toThrow('incomplete at expectedRecipeCount');
  });
});

describe('release source of truth (local Git only)', () => {
  let cwd, baselineSha, hardenedSha, releaseSha, outsideSha;
  const git = (...args) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const check = (overrides = {}) =>
    validateReleaseSource({ cwd, baselineSha, hardenedSha, ref: releaseSha, ...overrides });

  beforeAll(() => {
    cwd = mkdtempSync(path.join(tmpdir(), 'frigo-release-'));
    git('init', '-b', 'main');
    git('config', 'user.email', 'release-test@example.invalid');
    git('config', 'user.name', 'Release fixture');
    git('config', 'commit.gpgsign', 'false');
    mkdirSync(path.join(cwd, 'migrations'));
    writeFileSync(
      path.join(cwd, 'migrations/0001_initial.sql'),
      'CREATE TABLE fixture (id TEXT);\n',
    );
    git('add', '.');
    git('commit', '-m', 'Reviewed baseline');
    baselineSha = git('rev-parse', 'HEAD');
    git('commit', '--allow-empty', '-m', 'Final approved hardening');
    hardenedSha = git('rev-parse', 'HEAD');
    writeFileSync(
      path.join(cwd, 'migrations/0002_hardening.sql'),
      'CREATE INDEX fixture_id ON fixture(id);\n',
    );
    git('add', '.');
    git('commit', '-m', 'Release');
    releaseSha = git('rev-parse', 'HEAD');
    git('update-ref', 'refs/remotes/origin/main', releaseSha);
    git('tag', '-a', 'v1.0.0', '-m', 'Release tag');
    git('commit', '--allow-empty', '-m', 'Unmerged work');
    outsideSha = git('rev-parse', 'HEAD');
  });
  afterAll(() => rmSync(cwd, { recursive: true, force: true }));

  it('pins an approved full SHA in main with exact hardened ancestry', () => {
    expect(check()).toMatchObject({ sha: releaseSha, mainSha: releaseSha, hardenedSha });
  });

  it('resolves an annotated release tag once to an immutable SHA', () => {
    expect(check({ ref: 'refs/tags/v1.0.0' })).toMatchObject({
      requestedRef: 'refs/tags/v1.0.0',
      sha: releaseSha,
    });
  });

  it.each([
    'main',
    'codex/security-hardening-sync',
    'v1.0.0',
    'abc1234',
    'HEAD~1',
    '--help',
    'refs/tags/v1;id',
    'refs/heads/v1',
  ])('rejects mutable/ambiguous/unsafe ref %s', (ref) => {
    expect(() => check({ ref })).toThrow('full SHA or refs/tags/v*');
  });

  it('rejects a release outside main even if it contains hardening', () => {
    expect(() => check({ ref: outsideSha })).toThrow('not contained in main');
  });

  it('rejects a queued ancestor after origin/main advances', () => {
    git('update-ref', 'refs/remotes/origin/main', outsideSha);
    try {
      expect(() => check()).toThrow('stale; it must equal current origin/main');
      expect(() => check({ ref: 'refs/tags/v1.0.0' })).toThrow(
        'stale; it must equal current origin/main',
      );
    } finally {
      git('update-ref', 'refs/remotes/origin/main', releaseSha);
    }
  });

  it('rejects a release missing the approved hardening commit', () => {
    expect(() => check({ ref: baselineSha })).toThrow('exact approved hardening');
  });

  it('rejects an approved SHA older than the reviewed floor', () => {
    expect(() => check({ baselineSha: hardenedSha, hardenedSha: baselineSha })).toThrow('predates');
  });

  it('requires an exact, nonempty hardening SHA', () => {
    for (const value of ['', 'main', hardenedSha.slice(0, 7)])
      expect(() => check({ hardenedSha: value })).toThrow('exact approved');
  });

  it('hashes migrations from the immutable commit, never a dirty working tree', () => {
    const manifest = migrationManifest(cwd, releaseSha);
    expect(manifest).toMatchObject({ version: '0002_hardening.sql', count: 2 });
    expect(manifest.sha256).toMatch(/^[a-f0-9]{64}$/);
    writeFileSync(path.join(cwd, 'migrations/0001_initial.sql'), 'uncommitted alteration');
    expect(migrationManifest(cwd, releaseSha)).toEqual(manifest);
    expect(migrationManifest(cwd, baselineSha).sha256).not.toBe(manifest.sha256);
    git('restore', 'migrations/0001_initial.sql');
  });

  it('rejects missing migration sequence entries', () => {
    writeFileSync(path.join(cwd, 'migrations/0004_gap.sql'), 'SELECT 1;\n');
    git('add', '.');
    git('commit', '-m', 'Invalid migration fixture');
    expect(() => migrationManifest(cwd, git('rev-parse', 'HEAD'))).toThrow('gap');
  });
});

describe('hosted CI exact-head gate', () => {
  const check = (runs) => requireSuccessfulCi(runs, { sha: goodSha, repository });
  it('accepts a completed successful main push for the exact SHA', () => {
    expect(check([successful])).toMatchObject({ id: 2, attempt: 1, headSha: goodSha });
  });
  it.each([
    { head_sha: 'b'.repeat(40) },
    { head_branch: 'codex/security-hardening-sync' },
    { event: 'pull_request' },
    { event: 'workflow_dispatch' },
    { path: '.github/workflows/deploy.yml' },
    { repository: { full_name: 'fork/Frigo' } },
    { head_repository: { full_name: 'fork/Frigo' } },
    { status: 'in_progress', conclusion: null },
    { conclusion: 'failure' },
    { conclusion: 'cancelled' },
    { conclusion: 'skipped' },
    { conclusion: 'neutral' },
  ])('rejects stale, spoofed, PR-merge, pending, or non-green evidence: %j', (changes) => {
    expect(() => check([{ ...successful, ...changes }])).toThrow('Latest exact-SHA');
  });
  it('does not let an old green run mask a newer failed run or rerun', () => {
    expect(() => check([successful, { ...successful, id: 3, conclusion: 'failure' }])).toThrow();
    expect(() =>
      check([
        successful,
        { ...successful, run_attempt: 2, status: 'in_progress', conclusion: null },
      ]),
    ).toThrow();
    expect(() =>
      check([
        { ...successful, updated_at: '2026-09-08T01:00:00Z' },
        {
          ...successful,
          id: 1,
          run_attempt: 2,
          status: 'in_progress',
          conclusion: null,
          updated_at: '2026-09-08T02:00:00Z',
        },
      ]),
    ).toThrow();
  });
  it('fails closed when hosted results are absent or malformed', () => {
    expect(() => check([])).toThrow();
    expect(() => check(null)).toThrow();
  });
});

describe('schema and deployment receipts', () => {
  const schema = {
    version: '0002_auth.sql',
    migrations: [{ name: '0001_initial.sql' }, { name: '0002_auth.sql' }],
  };
  const ledger = [
    { success: true, results: [{ name: '0001_initial.sql' }, { name: '0002_auth.sql' }] },
  ];
  const manifest = { sha: goodSha, environment: 'production' };
  const ready = {
    commit: goodSha,
    environment: 'production',
    status: 'ok',
    services: { database: 'ok' },
    config: { ok: true },
  };

  it('records the actual SELECT-only ledger separately from source migration checksums', () => {
    expect(verifyMigrationLedger(schema, ledger)).toMatchObject({
      version: schema.version,
      names: ['0001_initial.sql', '0002_auth.sql'],
    });
  });
  it.each(
    [
      [],
      [{ success: false, results: [] }],
      [{ success: true, results: [] }],
      [{ success: true, results: [{ name: '0001_initial.sql' }] }],
      [{ success: true, results: [...ledger[0].results, { name: '0003_later.sql' }] }],
      [{ success: true, results: [...ledger[0].results, { name: '0002_auth.sql' }] }],
    ].map((statements) => ({ statements })),
  )('rejects missing, failed, duplicate, or unknown later schema: %j', ({ statements }) => {
    expect(() => verifyMigrationLedger(schema, statements)).toThrow();
  });
  it('records deployment only when readiness confirms exact SHA, environment, and health', () => {
    expect(verifyDeployedRelease(manifest, ready)).toMatchObject({
      sha: goodSha,
      environment: 'production',
    });
  });
  it.each([
    { environment: 'staging' },
    { status: 'unhealthy' },
    { status: undefined },
    { services: { database: 'error' } },
    { config: { ok: false } },
    { config: undefined },
  ])('rejects misleading or unhealthy deployment proof: %j', (changes) => {
    let caught;
    try {
      verifyDeployedRelease(manifest, { ...ready, ...changes });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught.code).toBeUndefined(); // never retryable
  });
  // Commit identity contract: only a canonical full SHA (40 lowercase hex) is accepted at all.
  const otherValidSha = 'b'.repeat(40);
  const caught = (body) => {
    try {
      verifyDeployedRelease(manifest, body);
    } catch (error) {
      return error;
    }
    return undefined;
  };
  it('A. exact expected canonical SHA passes', () => {
    expect(verifyDeployedRelease(manifest, { ...ready, commit: goodSha })).toMatchObject({
      sha: goodSha,
    });
  });
  it('B. a different valid canonical SHA on a healthy correct-environment body is the only retryable outcome', () => {
    expect(caught({ ...ready, commit: otherValidSha })).toMatchObject({
      code: RELEASE_PROPAGATION_PENDING,
      observedSha: otherValidSha,
    });
  });
  it.each([
    [
      'C. missing commit',
      (body) => {
        const { commit, ...rest } = body;
        return rest;
      },
    ],
    ['D. null commit', (body) => ({ ...body, commit: null })],
    ['E. empty commit', (body) => ({ ...body, commit: '' })],
    ['F. short SHA', (body) => ({ ...body, commit: goodSha.slice(0, 8) })],
    ['G. malformed SHA (branch name)', (body) => ({ ...body, commit: 'main' })],
    ['G. malformed SHA (uppercase)', (body) => ({ ...body, commit: goodSha.toUpperCase() })],
    ['G. malformed SHA (non-hex, right length)', (body) => ({ ...body, commit: 'g'.repeat(40) })],
    ['G. malformed SHA (41 chars)', (body) => ({ ...body, commit: `${goodSha}0` })],
    ['H. non-string commit (number)', (body) => ({ ...body, commit: 1234567890 })],
    ['H. non-string commit (object)', (body) => ({ ...body, commit: { sha: goodSha } })],
    ['H. non-string commit (array)', (body) => ({ ...body, commit: [goodSha] })],
    ['H. non-string commit (boolean)', (body) => ({ ...body, commit: true })],
  ])('%s fails closed immediately and is never retryable', (_label, mutate) => {
    const error = caught(mutate(ready));
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('not a canonical full Git SHA');
    expect(error.code).toBeUndefined();
  });
  it('I. wrong environment with a valid different SHA fails closed, not retryable', () => {
    const error = caught({ ...ready, commit: otherValidSha, environment: 'staging' });
    expect(error.message).toContain('SHA/environment');
    expect(error.code).toBeUndefined();
  });
  it.each([
    { status: 'unhealthy' },
    { services: { database: 'error' } },
    { config: { ok: false } },
  ])('J. unhealthy body with a valid different SHA fails closed, not retryable: %j', (changes) => {
    const error = caught({ ...ready, commit: otherValidSha, ...changes });
    expect(error.message).toBe('Deployed release is not ready');
    expect(error.code).toBeUndefined();
  });
  it('non-object readiness fails closed', () => {
    for (const body of [null, undefined, 'ok', 42])
      expect(() => verifyDeployedRelease(manifest, body)).toThrow('not an object');
  });
});

describe('release workflow guardrails', () => {
  const ci = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const deploy = readFileSync(
    new URL('../../.github/workflows/deploy.yml', import.meta.url),
    'utf8',
  );
  const migrate = readFileSync(
    new URL('../../.github/workflows/production-d1-migrate.yml', import.meta.url),
    'utf8',
  );
  // Every `run:` shell body (inline or `|`/`>` block scalar) of a workflow. Expression
  // interpolation of dispatch inputs inside these is a shell-injection vector; inputs must
  // reach the shell through `env:` only.
  const shellBodies = (workflow) => {
    const lines = workflow.split('\n');
    const bodies = [];
    for (let i = 0; i < lines.length; i += 1) {
      const match = /^(\s*)(?:- )?run:\s*(.*)$/.exec(lines[i]);
      if (!match) continue;
      const indent = match[1].length;
      if (/^[|>]/.test(match[2])) {
        const block = [];
        for (let j = i + 1; j < lines.length; j += 1) {
          const line = lines[j];
          if (line.trim() !== '' && line.search(/\S/) <= indent) break;
          block.push(line);
        }
        bodies.push(block.join('\n'));
      } else {
        bodies.push(match[2]);
      }
    }
    return bodies;
  };
  const unsafeInput = /\$\{\{[^}]*(?:\binputs\.|github\.event\.inputs)/;
  it('shell body extractor sees inline and block scalars and rejects interpolated inputs', () => {
    const sample =
      'steps:\n  - run: echo "${{ inputs.x }}"\n  - name: b\n    run: |\n      echo start\n      echo "${{ github.event.inputs.y }}"\n    env:\n      Z: ${{ inputs.z }}\n  - run: echo "$Z"\n';
    const bodies = shellBodies(sample);
    expect(bodies).toHaveLength(3);
    expect(bodies.filter((body) => unsafeInput.test(body))).toHaveLength(2);
    expect(unsafeInput.test('echo "$Z"')).toBe(false);
  });
  it('validates the active hardening branch and PRs with all existing local gates', () => {
    expect(ci).toContain('branches: [main, master, codex/security-hardening-sync]');
    expect(ci).toContain('pull_request:');
    for (const command of [
      'pnpm install --frozen-lockfile',
      'pnpm lint',
      'pnpm typecheck',
      'pnpm test',
      'pnpm check:migrations',
      'pnpm build',
    ]) {
      expect(ci).toContain(command);
      expect(deploy).toContain(command);
    }
  });
  it('keeps manual confirmation, protected environment, immutable checkout, and schema-before-deploy gates', () => {
    expect(deploy).toContain("github.ref == 'refs/heads/main'");
    expect(deploy).toContain('inputs.confirm_production == true');
    expect(deploy).toContain('environment: production');
    expect(deploy).toContain('ref: ${{ needs.release.outputs.deploy_sha }}');
    expect(deploy).toContain('GIT_COMMIT:${{ needs.release.outputs.deploy_sha }}');
    // T19B: full D1 is an explicit reviewed release state; 25 is the widest deterministic canary stage.
    expect(deploy).toContain('options: [static, shadow, canary, d1]');
    expect(deploy).toContain("options: ['0', '1', '2', '5', '25']");
    expect(deploy).toContain('confirm_recipe_catalog_rollback:');
    expect(deploy).toContain(
      'recipe_catalog_d1_canary_percent: ${{ steps.gate.outputs.recipe_catalog_d1_canary_percent }}',
    );
    expect(deploy).toContain(
      'recipe_catalog_cutover_enabled: ${{ steps.gate.outputs.recipe_catalog_cutover_enabled }}',
    );
    expect(deploy).toContain(
      "RECIPE_CATALOG_MODE: ${{ github.event_name == 'workflow_dispatch' && inputs.recipe_catalog_mode || 'static' }}",
    );
    expect(deploy).toContain(
      "RECIPE_CATALOG_D1_CANARY_PERCENT: ${{ github.event_name == 'workflow_dispatch' && inputs.recipe_catalog_d1_canary_percent || '0' }}",
    );
    expect(
      deploy.match(/RECIPE_CATALOG_MODE:\$\{\{ needs\.release\.outputs\.recipe_catalog_mode \}\}/g),
    ).toHaveLength(2);
    expect(
      deploy.match(
        /RECIPE_CATALOG_D1_CANARY_PERCENT:\$\{\{ needs\.release\.outputs\.recipe_catalog_d1_canary_percent \}\}/g,
      ),
    ).toHaveLength(2);
    expect(
      deploy.match(
        /RECIPE_CATALOG_CUTOVER_ENABLED:\$\{\{ needs\.release\.outputs\.recipe_catalog_cutover_enabled \}\}/g,
      ),
    ).toHaveLength(2);
    expect(deploy).not.toContain("options: ['0', '1', '2', '5', '10'");
    expect(deploy).not.toContain("'50'");
    expect(deploy).not.toContain("'100'");
    const dispatchInputs = deploy.slice(
      deploy.indexOf('workflow_dispatch:'),
      deploy.indexOf('\npermissions:'),
    );
    expect(dispatchInputs).not.toContain('recipe_catalog_cutover_enabled:');
    expect(deploy).toContain('cancel-in-progress: false');
    const production = deploy.slice(deploy.indexOf('\n  production:'));
    expect(production.indexOf('release-check.mjs recheck')).toBeLessThan(
      production.indexOf('d1-schema-gate.sh remote'),
    );
    expect(production.indexOf('release-check.mjs schema')).toBeLessThan(
      production.indexOf('command: deploy'),
    );
    for (const check of [
      'd1-migration-check.mjs config',
      'wrangler whoami',
      'wrangler d1 list --json',
      'd1-migration-check.mjs identity',
      'd1-migration-check.mjs runtime-catalog-query',
      'd1-migration-check.mjs runtime-catalog release-manifest.json',
      'd1-migration-check.mjs release-certify',
      'PRAGMA foreign_key_check',
      'PRAGMA quick_check',
    ]) {
      expect(production.indexOf(check), check).toBeGreaterThan(-1);
      expect(production.indexOf(check), check).toBeLessThan(production.indexOf('command: deploy'));
    }
    expect(production.indexOf('wrangler secret list')).toBeLessThan(
      production.indexOf('command: deploy'),
    );
    expect(production.indexOf('release-check.mjs transition')).toBeLessThan(
      production.indexOf('command: deploy'),
    );
    expect(production.indexOf('release-check.mjs rollback-target')).toBeLessThan(
      production.indexOf('command: deploy'),
    );
    expect(production.indexOf('command: deploy')).toBeLessThan(
      production.indexOf('wait-for-deployed-release.mjs'),
    );
    // Production authority proof is unconditional: no token ⇒ the step fails, never silently passes.
    const productionProof = production.slice(production.indexOf('recipe authority proof'));
    expect(productionProof).toContain(
      'node scripts/release-check.mjs authority release-manifest.json',
    );
    expect(productionProof).toContain(
      'node scripts/release-check.mjs deployed-binding release-manifest.json deployed-deployment.json deployed-version.json',
    );
    expect(production).toContain("always() && needs.release.result == 'success'");
    expect(productionProof).toContain(
      "if: (failure() || cancelled()) && steps.preflight.outcome == 'success'",
    );
    expect(productionProof).not.toContain('wrangler rollback');
    expect(productionProof).toContain(
      'node scripts/cloudflare-worker-rollback.mjs "$previous_version" > rollback-mutation.json',
    );
    expect(productionProof).toContain(
      'release-check.mjs rollback release-manifest.json rollback-deployment.json rollback-authority.json previous-version.json rollback-mutation.json',
    );
    expect(
      productionProof.slice(0, productionProof.indexOf('release-check.mjs authority')),
    ).not.toContain('if [ -n "$RELEASE_VERIFY_TOKEN" ]');
    expect(production).not.toContain('migrations apply');
    expect(production).not.toContain('frigo.tungjpstore.net');
  });
  it('T15C-C: the operator test cohort never travels through the workflow, Wrangler config, release manifest, or example env', () => {
    // Cohort digests are Worker secrets only; the deploy control plane must not know about them.
    const forbidden = /RECIPE_CATALOG_TEST_(COHORT_ENABLED|INCLUDE|EXCLUDE)|recipe_catalog_test_/;
    expect(deploy).not.toMatch(forbidden);
    expect(migrate).not.toMatch(forbidden);
    for (const file of [
      '../../wrangler.jsonc',
      '../../wrangler.staging.jsonc',
      '../../.dev.vars.example',
      '../../scripts/release-check.mjs',
    ]) {
      expect(readFileSync(new URL(file, import.meta.url), 'utf8'), file).not.toMatch(forbidden);
    }
  });
  it('both staging and production prove the exact deployed SHA through bounded convergence, never a single-shot curl', () => {
    const staging = deploy.slice(deploy.indexOf('\n  staging:'), deploy.indexOf('\n  production:'));
    const production = deploy.slice(deploy.indexOf('\n  production:'));
    expect(staging.length).toBeGreaterThan(0);
    expect(production.length).toBeGreaterThan(0);
    for (const job of [staging, production]) {
      expect(job).toContain('post-deploy-smoke.sh');
      expect(job).toContain('node scripts/wait-for-deployed-release.mjs release-manifest.json');
      expect(job).not.toMatch(/curl[^\n]*health\/ready[^\n]*> readiness\.json/);
      expect(job).not.toMatch(/release-check\.mjs deployed(?:\s|$)/);
      expect(job.indexOf('wait-for-deployed-release.mjs')).toBeLessThan(
        job.indexOf('post-deploy-smoke.sh'),
      );
      expect(job).toContain(
        'post-deploy-smoke.sh "$APP_SMOKE_URL" "${{ needs.release.outputs.deploy_sha }}"',
      );
      // T19D: recipe authority proof follows the SHA/smoke proof and reads the protected evidence through env only.
      expect(job.indexOf('post-deploy-smoke.sh')).toBeLessThan(
        job.indexOf('release-check.mjs authority release-manifest.json'),
      );
      expect(job).toMatch(/RELEASE_VERIFY_TOKEN: \$\{\{ secrets\.[A-Z_]*RELEASE_VERIFY_TOKEN \}\}/);
      // Forensic receipt survives a failed convergence.
      expect(job.slice(job.indexOf('wait-for-deployed-release.mjs'))).toMatch(
        /if: always\(\)[\s\S]*upload-artifact/,
      );
    }
    const stagingDeploy = staging.indexOf('command: deploy');
    const stagingProofConfig = staging.indexOf(
      'Require staging proof configuration before deployment',
    );
    expect(stagingProofConfig).toBeGreaterThan(-1);
    expect(stagingProofConfig).toBeLessThan(stagingDeploy);
    expect(staging).toContain('STAGING_URL must be an exact HTTPS origin');
    expect(staging).toContain('STAGING_RELEASE_VERIFY_TOKEN must be configured before deployment');
    expect(staging).toContain('Staging Worker RELEASE_VERIFY_TOKEN is not provisioned');
    expect(staging).not.toContain("vars.STAGING_URL != ''");
    expect(staging).not.toContain('if [ -n "$RELEASE_VERIFY_TOKEN" ]');
    // The bounded helper is the single deployment proof; no other deploy step redeploys after it.
    expect(deploy.match(/wait-for-deployed-release\.mjs/g)).toHaveLength(2);
  });
  it('carries no write permission or shell-interpolated dispatch input', () => {
    expect(deploy).not.toMatch(/(?:contents|actions|id-token|deployments): write/);
    for (const body of shellBodies(deploy)) expect(body).not.toMatch(unsafeInput);
    expect(deploy).toContain('persist-credentials: false');
  });

  it('production D1 migration workflow keeps every fail-closed gate in order (pinned chain + catalog certification)', () => {
    expect(migrate).toContain('workflow_dispatch:');
    expect(migrate).not.toMatch(/\n\s+(?:push|pull_request|schedule|workflow_run):/);
    expect(migrate).toContain("github.ref == 'refs/heads/main'");
    expect(migrate).toContain('inputs.confirm_production_migration == true');
    expect(migrate).toContain('environment: production');
    expect(migrate).toContain('cancel-in-progress: false');
    expect(migrate).toContain('persist-credentials: false');
    expect(migrate).toMatch(/permissions:\n\s+contents: read\n\s+actions: read/);
    expect(migrate).not.toMatch(/(?:contents|actions|id-token|deployments): write/);
    for (const body of shellBodies(migrate)) expect(body).not.toMatch(unsafeInput);
    // Dispatch inputs reach the shell only through env, including the certification-only notice.
    expect(migrate).toMatch(
      /env:\n\s+MIGRATION: \$\{\{ inputs\.migration \}\}\n\s+run: echo "::notice::\$MIGRATION/,
    );
    const order = [
      'd1-migration-check.mjs gate',
      'd1-migration-check.mjs config',
      'd1-migration-check.mjs identity',
      'd1-migration-check.mjs pre-ledger',
      'time-travel info',
      'd1-migration-check.mjs bookmark',
      'd1-migration-check.mjs baseline',
      'd1-migration-check.mjs plan',
      'migrations apply frigo-db --remote',
      'd1-migration-check.mjs post-ledger',
      'd1-migration-check.mjs verify',
      'd1-migration-check.mjs catalog',
      'd1-migration-check.mjs runtime-catalog-query',
      'd1-migration-check.mjs runtime-catalog migration-manifest.json',
      'd1-schema-gate.sh remote',
    ];
    const positions = order.map((needle) => migrate.indexOf(needle));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    // Exactly one identity/catalog certification, plus complete-release runtime hydration and fingerprinting.
    expect(migrate.match(/d1-migration-check\.mjs catalog/g)).toHaveLength(1);
    expect(migrate).toMatch(/if: steps\.pre_ledger\.outputs\.mode == 'apply'/);
    expect(migrate).toContain('m.catalogQuery()');
    expect(migrate).toContain('catalog.releaseComplete');
    // Chain-aware input contract: candidate chain = everything strictly after expected_pre_tip through migration.
    expect(migrate).toMatch(
      /expected_pre_tip:\n\s+description: [^\n]*current production ledger tip/,
    );
    expect(migrate).toMatch(/migration:\n\s+description: [^\n]*ledger must end at after this run/);
    expect(migrate).toMatch(
      /ref:\n\s+description: [^\n]*every migration after `expected_pre_tip` is applied in order/,
    );
    expect(migrate).not.toMatch(/single migration/i);
    // The receipt artifact is always saved, even when a gate fails.
    expect(migrate.slice(migrate.indexOf('d1-schema-gate.sh remote'))).toMatch(
      /if: always\(\)[\s\S]*upload-artifact/,
    );
  });
});
