export interface RecipeCatalogRollout {
  mode: 'static' | 'shadow' | 'canary' | 'd1';
  canaryPercent: number;
  cutoverEnabled: boolean;
}

export interface RecipeAuthorityReleaseRef {
  releaseId: string;
  legacyBaselineCount: number;
  expectedRecipeCount: number;
  legacyBaselineFingerprint: string;
  expectedRuntimeFingerprint: string;
}

export interface RecipeAuthorityProof {
  configuredMode: string;
  cutoverEnabled: boolean;
  canaryPercent: number;
  actualSource: 'static' | 'd1';
  globalSource: 'static' | 'd1' | 'mixed';
  servedRecipeCount: number;
  servedFingerprint: string;
  releaseId: string;
  d1Readiness: string;
  fallbackReason: string | null;
  checkedAt: string;
}

export const RELEASE_RECIPE_CATALOG_MODES: readonly string[];
export const RELEASE_CANARY_PERCENT_OPTIONS: readonly number[];
export function resolveMealCompositionV2Release(input: { eventName: unknown; input: unknown }): 'true' | 'false';
export function validateRecipeCatalogMode(value: unknown): RecipeCatalogRollout['mode'];
export function validateRecipeCatalogRollout(input: { mode: unknown; canaryPercent: unknown }): Readonly<RecipeCatalogRollout>;
export function validateRecipeCatalogManifestPolicy(manifest: unknown): Readonly<RecipeCatalogRollout>;
export function verifyRecipeAuthorityEvidence(
  manifest: { sha: string; environment: string; recipeCatalogMode: string; recipeCatalogCanaryPercent: number; recipeCatalogCutoverEnabled: boolean },
  evidence: unknown,
  release: RecipeAuthorityReleaseRef,
): RecipeAuthorityProof;
