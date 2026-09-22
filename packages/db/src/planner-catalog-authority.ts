import { CANONICAL_INGREDIENTS } from '../../domain/src';
import { createRecipeCatalog, type CatalogDiagnostic, type RecipeCatalogSnapshot } from '../../recipes/src/catalog';
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
 *   fenced to the snapshot's recipe IDs. Readiness already proved D1 == release, so the fence is
 *   a guard, never a correction.
 * - `source = 'static'` (static, shadow, canary-outside, or ANY D1 fallback): recipe definitions
 *   and steps come from the static snapshot itself — the exact content the Recipe API serves —
 *   while D1 contributes only supplementary planner facts keyed by visible recipe ID
 *   (classifications, nutrition links, families, ingredient IDs, diagnostics).
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

function staticRecipeDefinition(recipe: Recipe): Record<string, unknown> {
  return {
    id: recipe.id, slug: recipe.slug, title: recipe.title, description: recipe.description,
    cuisine: recipe.cuisine, servings: recipe.servings, cookTimeMinutes: recipe.cookTimeMinutes,
    difficulty: recipe.difficulty,
    provenance: { sourceType: 'legacy', verificationState: 'unverified' },
    ingredients: recipe.ingredients.map((line) => ({
      ingredientId: line.ingredientId, name: line.name, requiredQuantity: line.requiredQuantity,
      unit: line.unit, isOptional: line.isOptional ?? false,
    })),
  };
}

function staticRecipeSteps(recipe: Recipe): MealPlanningRecipeStep[] {
  return recipe.steps.map((step) => ({
    id: `${recipe.id}:static:${step.stepNumber}`, recipeId: recipe.id, stepNumber: step.stepNumber,
    instruction: step.instruction, tip: step.tip ?? null, timerMinutes: step.timerMinutes ?? null,
  }));
}

/** Recipe/classification diagnostics name a recipe; keep only those about visible recipes. */
function visibleDiagnostics(diagnostics: readonly CatalogDiagnostic[], visible: ReadonlySet<string>): CatalogDiagnostic[] {
  return diagnostics.filter((diagnostic) =>
    !((diagnostic.entity === 'recipe' || diagnostic.entity === 'classification') && diagnostic.id !== undefined && !visible.has(diagnostic.id)));
}

/**
 * Projects the D1 planner reads onto the effective recipe authority. Pure and deterministic for
 * equal inputs, so the planner fingerprint derived from the result is stable.
 */
export function projectPlannerCatalogOnAuthority(input: {
  authority: RecipeAuthoritySnapshot;
  catalogResults: readonly D1Result<unknown>[];
  nutrition: readonly RankingNutritionRow[];
  recipeSteps: readonly MealPlanningRecipeStep[];
}): AuthorityPlannerCatalog {
  if (input.catalogResults.length !== RECIPE_CATALOG_READ_STATEMENT_COUNT) {
    throw new Error('Recipe catalog batch returned an unexpected result count');
  }
  const d1 = mapRecipeCatalogRead(input.catalogResults);
  const authorityRecipes = input.authority.list();
  const visibleRecipeIds: ReadonlySet<string> = new Set(authorityRecipes.map((recipe) => recipe.id));
  const inUniverse = (recipeId: string) => visibleRecipeIds.has(recipeId);
  const nutrition = input.nutrition.filter((row) => typeof row.recipe_id === 'string' && inUniverse(row.recipe_id));
  const classifications = d1.classifications.filter((fact) => inUniverse(fact.recipeId));
  const diagnostics = visibleDiagnostics(d1.diagnostics, visibleRecipeIds);

  if (input.authority.source === 'd1') {
    return {
      catalog: { ...d1, source: 'd1', recipes: d1.recipes.filter((recipe) => inUniverse(recipe.id)), classifications, diagnostics },
      nutrition,
      recipeSteps: input.recipeSteps.filter((step) => inUniverse(step.recipeId)),
      visibleRecipeIds,
    };
  }

  const catalog = createRecipeCatalog({
    source: 'static',
    ingredientIds: [...new Set([...d1.ingredientIds, ...CANONICAL_INGREDIENTS.map((ingredient) => ingredient.id)])],
    recipes: authorityRecipes.map(staticRecipeDefinition),
    families: d1.families,
    classifications,
    diagnostics,
  });
  return {
    catalog,
    nutrition,
    recipeSteps: authorityRecipes.flatMap(staticRecipeSteps),
    visibleRecipeIds,
  };
}
