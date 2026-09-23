import { z } from 'zod';
import { canonicalJson, type PlanningSourceInput } from '../../recipes/src/planner-context';
import {
  InventoryLotSnapshotSchema,
  type InventoryLotSnapshot,
} from '../../recipes/src/planner-inventory';
import type { RecipeCatalogSnapshot } from '../../recipes/src/catalog';
import type { RankingContext } from '../../recipes/src/personalization';
import type { RecipeAuthoritySnapshot } from '../../recipes/src/recipe-authority';
import type { D1DatabaseBinding, D1Result } from './index';
import { RECIPE_CATALOG_READ_STATEMENT_COUNT, prepareRecipeCatalogRead } from './recipe-catalog';
import {
  projectPlannerCatalogOnAuthority,
  type MealPlanningRecipeStep,
} from './planner-catalog-authority';
import {
  RANKING_CONTEXT_READ_STATEMENT_COUNT,
  RankingContextAuthorizationError,
  mapRankingContextRead,
  prepareRankingContextRead,
} from './personalization';
import {
  RANKING_NUTRITION_READ_STATEMENT_COUNT,
  createRankingEvidenceProviderFromNutritionRows,
  mapRankingNutritionRows,
  prepareRankingNutritionRead,
  type RankingNutritionRow,
} from './ranking-nutrition';

export interface MealPlanningSnapshotScope {
  householdId: string;
  userId: string;
}

export type { MealPlanningRecipeStep } from './planner-catalog-authority';

/** Identity of the recipe authority a planner snapshot was projected onto (persisted with plans). */
export interface MealPlanningAuthorityIdentity {
  source: 'static' | 'd1';
  /** Recipe authority snapshot fingerprint (SHA-256 hex over the canonical ordered runtime projection). */
  fingerprint: string;
  recipeCount: number;
}

export interface MealPlanningSnapshotFingerprint {
  algorithm: 'sha-256';
  value: string;
  parts: {
    inventory: string;
    preferences: string;
    catalog: string;
    history: string;
  };
}

export interface MealPlanningSnapshot {
  catalog: RecipeCatalogSnapshot;
  inventory: InventoryLotSnapshot[];
  rankingContext: RankingContext;
  evidenceProvider: NonNullable<PlanningSourceInput['evidenceProvider']>;
  recipeSteps: MealPlanningRecipeStep[];
  fingerprint: MealPlanningSnapshotFingerprint;
  /** The effective recipe authority this snapshot is fenced to; the planner universe is exactly its recipes. */
  authority: MealPlanningAuthorityIdentity;
  visibleRecipeIds: ReadonlySet<string>;
}

export class MealPlanningSnapshotAuthorizationError extends Error {
  readonly code = 'MEAL_PLANNING_SNAPSHOT_UNAUTHORIZED';

  constructor() {
    super('Meal planning snapshot is not authorized');
    this.name = 'MealPlanningSnapshotAuthorizationError';
  }
}

export const MEAL_PLANNING_SNAPSHOT_STATEMENT_COUNT =
  RECIPE_CATALOG_READ_STATEMENT_COUNT +
  RANKING_CONTEXT_READ_STATEMENT_COUNT +
  1 +
  RANKING_NUTRITION_READ_STATEMENT_COUNT;

export const STATIC_MEAL_PLANNING_SNAPSHOT_STATEMENT_COUNT =
  RANKING_CONTEXT_READ_STATEMENT_COUNT + 1;

const InventoryRowSchema = z
  .object({
    id: z.string(),
    household_id: z.string(),
    version: z.number(),
    ingredient_id: z.string().nullable(),
    quantity: z.number(),
    unit: z.string(),
    freshness: z.string().nullable(),
    expiry_date: z.string().nullable(),
    expiry_kind: z.string(),
    storage: z.string(),
    opened_at: z.string().nullable(),
    expiry_source: z.string(),
    added_date: z.string(),
    updated_at: z.string(),
  })
  .strict();

function rows(result: D1Result<unknown>, label: string): Record<string, unknown>[] {
  if (!result.success || !Array.isArray(result.results)) {
    throw new Error(`Meal planning ${label} read failed`);
  }
  return result.results.map((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new Error(`Meal planning ${label} row is invalid`);
    }
    return row as Record<string, unknown>;
  });
}

function mapInventory(
  result: D1Result<unknown>,
  scope: MealPlanningSnapshotScope,
): InventoryLotSnapshot[] {
  return rows(result, 'inventory')
    .map((raw) => {
      const row = InventoryRowSchema.parse(raw);
      return InventoryLotSnapshotSchema.parse({
        id: row.id,
        householdId: row.household_id,
        version: row.version,
        ingredientId: row.ingredient_id ?? '',
        quantity: row.quantity,
        unit: row.unit,
        freshness: row.freshness,
        expiryDate: row.expiry_date,
        expiryKind: row.expiry_kind,
        storage: row.storage,
        openedAt: row.opened_at,
        expirySource: row.expiry_source,
        addedDate: row.added_date,
        updatedAt: row.updated_at,
      });
    })
    .map((lot) => {
      if (lot.householdId !== scope.householdId) {
        throw new Error('Meal planning inventory scope mismatch');
      }
      return lot;
    });
}

async function sha256Hex(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const cryptoApi = globalThis as unknown as {
    crypto: { subtle: { digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer> } };
  };
  const digest = await cryptoApi.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function fingerprintFor(input: {
  inventory: InventoryLotSnapshot[];
  rankingContext: RankingContext;
  catalog: RecipeCatalogSnapshot;
  nutrition: RankingNutritionRow[];
  recipeSteps: MealPlanningRecipeStep[];
}): Promise<MealPlanningSnapshotFingerprint> {
  const [inventory, preferences, catalog, history] = await Promise.all([
    sha256Hex(input.inventory),
    sha256Hex(input.rankingContext.preferences),
    sha256Hex({
      catalog: input.catalog,
      nutrition: input.nutrition,
      recipeSteps: input.recipeSteps,
    }),
    sha256Hex(input.rankingContext.feedback),
  ]);
  const parts = { inventory, preferences, catalog, history };
  return { algorithm: 'sha-256', parts, value: await sha256Hex(parts) };
}

/**
 * Reads all T02–T04 inputs in one D1 batch and projects the catalog facts onto the request's
 * effective recipe authority (T19): the planner may only see recipes the Recipe API, Shopping and
 * Cooking resolve for the same household under the same deployment. Recipe content and steps come
 * from the authority snapshot itself; D1 supplies only planner enrichment (families, classifications,
 * nutrition) under D1 authority. The returned evidence provider is synchronous and in-memory, so
 * planner search performs no database I/O.
 */
export async function loadMealPlanningSnapshot(
  db: D1DatabaseBinding,
  scope: MealPlanningSnapshotScope,
  referenceTime: string,
  authority: RecipeAuthoritySnapshot,
): Promise<MealPlanningSnapshot> {
  const catalogStatements = authority.source === 'd1' ? prepareRecipeCatalogRead(db) : [];
  const rankingStatements = prepareRankingContextRead(db, scope, referenceTime);
  const inventoryStatement = db
    .prepare(
      `SELECT id, household_id, version, ingredient_id, quantity, unit, freshness,
        expiry_date, expiry_kind, storage, opened_at, expiry_source, added_date, updated_at
     FROM inventory_items WHERE household_id = ? ORDER BY id`,
    )
    .bind(scope.householdId);
  const nutritionStatements = authority.source === 'd1' ? prepareRankingNutritionRead(db) : [];
  const essentialStatements = [...rankingStatements, inventoryStatement];
  let results: D1Result<unknown>[];
  let includesEnrichments = authority.source === 'd1';
  if (includesEnrichments) {
    try {
      results = await db.batch([
        ...catalogStatements,
        ...essentialStatements,
        ...nutritionStatements,
      ]);
      if (results.length !== MEAL_PLANNING_SNAPSHOT_STATEMENT_COUNT) {
        throw new Error('Meal planning snapshot batch returned an unexpected result count');
      }
    } catch {
      includesEnrichments = false;
      results = await db.batch(essentialStatements);
      if (results.length !== STATIC_MEAL_PLANNING_SNAPSHOT_STATEMENT_COUNT) {
        throw new Error(
          'Meal planning snapshot fallback batch returned an unexpected result count',
        );
      }
    }
  } else {
    results = await db.batch(essentialStatements);
    if (results.length !== STATIC_MEAL_PLANNING_SNAPSHOT_STATEMENT_COUNT) {
      throw new Error('Meal planning snapshot batch returned an unexpected result count');
    }
  }

  const rankingIndex = includesEnrichments ? catalogStatements.length : 0;
  let rankingContext: RankingContext;
  try {
    rankingContext = mapRankingContextRead(
      results.slice(rankingIndex, rankingIndex + RANKING_CONTEXT_READ_STATEMENT_COUNT),
      scope,
    );
  } catch (error) {
    if (error instanceof RankingContextAuthorizationError) {
      throw new MealPlanningSnapshotAuthorizationError();
    }
    throw error;
  }

  const inventoryIndex = rankingIndex + RANKING_CONTEXT_READ_STATEMENT_COUNT;
  const nutritionIndex = inventoryIndex + 1;
  const inventory = mapInventory(results[inventoryIndex], scope);
  let catalogResults: readonly D1Result<unknown>[] = [];
  let nutritionRows: RankingNutritionRow[] = [];
  try {
    if (includesEnrichments) {
      catalogResults = results.slice(0, catalogStatements.length);
      nutritionRows = mapRankingNutritionRows(
        results.slice(
          nutritionIndex,
          nutritionIndex + nutritionStatements.length,
        ) as D1Result<RankingNutritionRow>[],
      );
    }
  } catch {
    catalogResults = [];
    nutritionRows = [];
  }

  let projection;
  try {
    projection = projectPlannerCatalogOnAuthority({
      authority,
      catalogResults,
      nutrition: nutritionRows,
    });
  } catch (error) {
    if (authority.source !== 'd1') throw error;
    projection = projectPlannerCatalogOnAuthority({
      authority,
      catalogResults: [],
      nutrition: [],
    });
  }
  const { catalog, nutrition, recipeSteps, visibleRecipeIds } = projection;
  // The catalog part hashes only authority-visible facts, so an invisible (e.g. D1-only under
  // static) recipe change can never stale a plan whose universe did not change.
  const fingerprint = await fingerprintFor({
    inventory,
    rankingContext,
    catalog,
    nutrition,
    recipeSteps,
  });

  return {
    catalog,
    inventory,
    rankingContext,
    // There is no reviewed safety/substitution registry. Nutrition remains
    // unverified and every safety verdict is intentionally absent.
    evidenceProvider: createRankingEvidenceProviderFromNutritionRows(nutrition),
    recipeSteps,
    fingerprint,
    authority: {
      source: authority.source,
      fingerprint: authority.fingerprint,
      recipeCount: authority.size,
    },
    visibleRecipeIds,
  };
}
