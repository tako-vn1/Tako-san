import { currentCatalogRelease, type RecipeAuthorityReadiness } from '../../../packages/recipes/src/recipe-authority';
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
 * tenant key that is never a real household (canary cohort membership is therefore reported as the
 * configured policy, not a per-user decision). Nothing here contains household IDs, emails, tokens,
 * secrets, binding identifiers or recipe rows.
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
  /** Source the probe request actually resolved to (the release-wide truth outside canary cohorts). */
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
    return { config: null, invalid: error instanceof RecipeAuthorityConfigError ? error.code : 'INVALID_MODE' };
  }
}

function globalSourceOf(mode: RecipeAuthorityMode | 'invalid', canaryPercent: number, actualSource: 'static' | 'd1'): RecipeAuthorityGlobalSource {
  if (mode === 'canary') return canaryPercent >= 100 ? actualSource : canaryPercent === 0 ? 'static' : 'mixed';
  return actualSource;
}

/** Sanitized status for the anonymous readiness body. Resolves the authority once (no D1 read unless mode selects D1). */
export async function publicRecipeAuthorityStatus(env: RecipeAuthorityEnv): Promise<RecipeAuthorityPublicStatus> {
  const release = currentCatalogRelease();
  const { config, invalid } = configOrInvalid(env);
  if (!config) {
    return { configuredMode: 'invalid', cutoverEnabled: false, canaryPercent: 0, globalSource: 'static', fallbackReason: invalid, releaseId: release.releaseId, expectedRecipeCount: release.expectedRecipeCount };
  }
  const resolution = await resolveRecipeAuthority(env, { tenantKey: PROBE_TENANT_KEY, log: () => {} });
  return {
    configuredMode: config.mode, cutoverEnabled: config.cutoverEnabled, canaryPercent: config.canaryPercent,
    globalSource: globalSourceOf(config.mode, config.canaryPercent, config.mode === 'canary' ? 'd1' : resolution.actualSource),
    fallbackReason: config.mode === 'canary' ? null : resolution.fallbackReason,
    releaseId: release.releaseId, expectedRecipeCount: release.expectedRecipeCount,
  };
}

/**
 * Full release evidence for deploy automation. In `canary` mode the probe is resolved as if the
 * tenant were INSIDE the cohort (`RECIPE_CATALOG_D1_CANARY_PERCENT` forced to 100 for the probe
 * only) so D1 readiness and the served D1 fingerprint are actually exercised; the reported
 * `canaryPercent` stays the configured value.
 */
export async function recipeAuthorityReleaseEvidence(env: Env, options: { now?: () => Date } = {}): Promise<RecipeAuthorityReleaseEvidence> {
  const release = currentCatalogRelease();
  const status = await publicRecipeAuthorityStatus(env);
  const probeEnv: RecipeAuthorityEnv = status.configuredMode === 'canary'
    ? { ...env, RECIPE_CATALOG_D1_CANARY_PERCENT: '100', RECIPE_CATALOG_TEST_COHORT_ENABLED: undefined, RECIPE_CATALOG_TEST_INCLUDE: undefined, RECIPE_CATALOG_TEST_EXCLUDE: undefined }
    : env;
  const resolution = await resolveRecipeAuthority(probeEnv, { tenantKey: PROBE_TENANT_KEY, log: () => {} });
  const notReady = resolution.diagnostics.find((record) => record.event === 'recipe_catalog_d1_not_ready');
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
    fingerprintMatchesRelease: resolution.snapshot.fingerprint === release.expectedRuntimeFingerprint,
    d1Readiness: !d1Selected ? 'not_evaluated' : resolution.actualSource === 'd1' ? 'ready' : notReady ? 'not_ready' : 'error',
    d1ReadinessCode: d1Selected && resolution.actualSource !== 'd1' ? (notReady?.reasonCode ?? resolution.fallbackReason) : null,
    fallbackReason: status.configuredMode === 'canary' ? resolution.fallbackReason : status.fallbackReason,
    counters: recipeAuthorityCounters(),
  };
}

/** Constant-time comparison of two ASCII/UTF-8 secrets. */
export async function releaseVerifyTokenMatches(presented: string | undefined, expected: string | undefined): Promise<boolean> {
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
