import { CANONICAL_INGREDIENTS } from '../../domain/src';
import {
  createRecipeCatalog,
  type CatalogDiagnostic,
  type RecipeCatalogSnapshot,
} from '../../recipes/src/catalog';
import type { RecipeAuthoritySnapshot } from '../../recipes/src/recipe-authority';
import type { Recipe } from '../../recipes/src/types';
import type { D1Result } from './index';
import { mapRecipeCatalogRead, RECIPE_CATALOG_READ_STATEMENT_COUNT } from './recipe-catalog';
import type { RankingNutritionRow } from './ranking-nutrition';

/**
 * T19 — authority-aware planner catalog (ADR-026 extension).
 *
 * The Meal Planner needs rich catalog facts (definitions, families, classifications, provenance,
 * nutrition rows, steps), but the recipe UNIVERSE it may plan from is decided by the same
 * `RecipeAuthoritySnapshot` the Recipe API, Week, Shopping and Cooking resolve for the request.
 * This module projects the raw D1 planner batch onto that universe:
 *
 * - `source = 'd1'` (verified D1 is the effective authority): the D1 rows are the planner truth,
 *   fenced to the snapshot's recipe IDs and their referenced families/ingredients. Readiness
 *   already proved the runtime recipes equal the release; the remaining fences prevent unrelated
 *   planner-only rows from extending that authority.
 * - `source = 'static'` (static, shadow, or canary-outside): definitions and steps come only from
 *   the static snapshot. D1 planner reads are not part of this projection.
 * - an empty enrichment input for `source = 'd1'` is an authority-only D1 projection. It keeps the
 *   resolved D1 recipe set/content while omitting optional D1 families, classifications, diagnostics,
 *   and nutrition when enrichment is unavailable.
 *
 * Every output is filtered to the universe, so a planner fingerprint derived from it cannot move
 * because an invisible D1-only recipe changed.
 */
export interface MealPlanningRecipeStep {
  id: string;
  recipeId: string;
  stepNumber: number;
  instruction: string;
  tip: string | null;
  timerMinutes: number | null;
}

export interface AuthorityPlannerCatalog {
  catalog: RecipeCatalogSnapshot;
  nutrition: RankingNutritionRow[];
  recipeSteps: MealPlanningRecipeStep[];
  /** Recipe IDs visible under the effective authority: the planner universe. */
  visibleRecipeIds: ReadonlySet<string>;
}

function authorityRecipeDefinition(
  recipe: Recipe,
  enrichment?: RecipeCatalogSnapshot['recipes'][number],
): Record<string, unknown> {
  return {
    id: recipe.id,
    slug: recipe.slug,
    title: recipe.title,
    description: recipe.description,
    cuisine: recipe.cuisine,
    servings: recipe.servings,
    ...(enrichment?.prepTimeMinutes === undefined
      ? {}
      : { prepTimeMinutes: enrichment.prepTimeMinutes }),
    cookTimeMinutes: recipe.cookTimeMinutes,
    difficulty: recipe.difficulty,
    provenance: enrichment?.provenance ?? {
      sourceType: 'legacy',
      verificationState: 'unverified',
    },
    ...(enrichment?.familyId === undefined ? {} : { familyId: enrichment.familyId }),
    ingredients: recipe.ingredients.map((line) => ({
      ingredientId: line.ingredientId,
      name: line.name,
      requiredQuantity: line.requiredQuantity,
      unit: line.unit,
      isOptional: line.isOptional ?? false,
    })),
  };
}

function staticRecipeSteps(recipe: Recipe): MealPlanningRecipeStep[] {
  return recipe.steps.map((step) => ({
    id: `${recipe.id}:static:${step.stepNumber}`,
    recipeId: recipe.id,
    stepNumber: step.stepNumber,
    instruction: step.instruction,
    tip: step.tip ?? null,
    timerMinutes: step.timerMinutes ?? null,
  }));
}

function visibleD1Diagnostics(
  diagnostics: readonly CatalogDiagnostic[],
  recipes: ReadonlySet<string>,
  families: ReadonlySet<string>,
  ingredients: ReadonlySet<string>,
): CatalogDiagnostic[] {
  return diagnostics.filter((diagnostic) => {
    if (diagnostic.id === undefined) return false;
    if (diagnostic.entity === 'recipe' || diagnostic.entity === 'classification') {
      return recipes.has(diagnostic.id);
    }
    if (diagnostic.entity === 'family') return families.has(diagnostic.id);
    if (diagnostic.entity === 'ingredient') return ingredients.has(diagnostic.id);
    return false;
  });
}

/**
 * Projects the D1 planner reads onto the effective recipe authority. Pure and deterministic for
 * equal inputs, so the planner fingerprint derived from the result is stable.
 */
export function projectPlannerCatalogOnAuthority(input: {
  authority: RecipeAuthoritySnapshot;
  catalogResults: readonly D1Result<unknown>[];
  nutrition: readonly RankingNutritionRow[];
}): AuthorityPlannerCatalog {
  const authorityRecipes = input.authority.list();
  const visibleRecipeIds: ReadonlySet<string> = new Set(
    authorityRecipes.map((recipe) => recipe.id),
  );
  const inUniverse = (recipeId: string) => visibleRecipeIds.has(recipeId);

  const authorityOnly = (source: 'static' | 'd1'): AuthorityPlannerCatalog => {
    const authorityIngredientIds = new Set(
      CANONICAL_INGREDIENTS.map((ingredient) => ingredient.id),
    );
    for (const recipe of authorityRecipes) {
      for (const line of recipe.ingredients) authorityIngredientIds.add(line.ingredientId);
    }
    return {
      catalog: createRecipeCatalog({
        source,
        ingredientIds: [...authorityIngredientIds],
        recipes: authorityRecipes.map((recipe) => authorityRecipeDefinition(recipe)),
      }),
      nutrition: [],
      recipeSteps: authorityRecipes.flatMap(staticRecipeSteps),
      visibleRecipeIds,
    };
  };

  // Static/shadow/canary-outside must never consume D1 planner facts.
  if (input.authority.source === 'static') return authorityOnly('static');
  // D1 enrichment is optional; the resolved authority remains the planner universe on failure.
  if (input.catalogResults.length === 0) return authorityOnly('d1');

  if (input.catalogResults.length !== RECIPE_CATALOG_READ_STATEMENT_COUNT) {
    throw new Error('Recipe catalog batch returned an unexpected result count');
  }
  const d1 = mapRecipeCatalogRead(input.catalogResults);
  const nutrition = input.nutrition.filter(
    (row) => typeof row.recipe_id === 'string' && inUniverse(row.recipe_id),
  );
  const classifications = d1.classifications.filter((fact) => inUniverse(fact.recipeId));
  const visibleD1Recipes = d1.recipes.filter((recipe) => inUniverse(recipe.id));
  const visibleFamilyIds: ReadonlySet<string> = new Set(
    visibleD1Recipes
      .map((recipe) => recipe.familyId)
      .filter((familyId): familyId is string => familyId !== undefined),
  );
  const families = d1.families.filter((family) => visibleFamilyIds.has(family.id));
  const referencedD1IngredientIds = new Set<string>();
  for (const recipe of visibleD1Recipes) {
    for (const line of recipe.ingredients ?? []) referencedD1IngredientIds.add(line.ingredientId);
  }
  for (const family of families) {
    for (const slot of family.slots) {
      for (const option of slot.options) referencedD1IngredientIds.add(option.ingredientId);
    }
  }

  const d1ById = new Map(visibleD1Recipes.map((recipe) => [recipe.id, recipe]));
  const authorityIngredientIds = new Set(referencedD1IngredientIds);
  for (const recipe of authorityRecipes) {
    for (const line of recipe.ingredients) authorityIngredientIds.add(line.ingredientId);
  }

  return {
    catalog: createRecipeCatalog({
      source: 'd1',
      ingredientIds: d1.ingredientIds.filter((ingredientId) =>
        authorityIngredientIds.has(ingredientId),
      ),
      // Recipe content and steps come from the already-resolved authority snapshot. Raw D1 reads
      // supply planner-only metadata but cannot race the Recipe API's coherent content view.
      recipes: authorityRecipes.map((recipe) =>
        authorityRecipeDefinition(recipe, d1ById.get(recipe.id)),
      ),
      families,
      classifications,
      diagnostics: visibleD1Diagnostics(
        d1.diagnostics,
        visibleRecipeIds,
        visibleFamilyIds,
        authorityIngredientIds,
      ),
    }),
    nutrition,
    recipeSteps: authorityRecipes.flatMap(staticRecipeSteps),
    visibleRecipeIds,
  };
}
