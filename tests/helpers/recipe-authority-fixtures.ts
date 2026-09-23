import {
  createRecipeAuthoritySnapshot,
  type RecipeAuthoritySnapshot,
} from '../../packages/recipes/src/recipe-authority';
import type { Recipe } from '../../packages/recipes/src/types';
import type { SqliteD1 } from './sqlite-d1';

/**
 * T19 test seam: a `d1`-source recipe authority whose universe is exactly the `recipes` rows in the
 * fixture database at call time. Planner suites that seed synthetic D1 recipes (`a-small`,
 * `z-large`, `preview-*`) install it through `createMealPlanningRoutes({ recipeAuthority })`, which
 * is server composition — the same seam production uses to install `resolveRecipeAuthority`.
 * It performs no readiness verification and is never importable by Worker code.
 */
export function fixtureRecipeAuthority(db: SqliteD1): () => Promise<RecipeAuthoritySnapshot> {
  return async () => {
    const rows = db.query<{
      id: string; slug: string; title: string; description: string | null; cuisine: string;
      servings: number; cook_time_minutes: number; difficulty: Recipe['difficulty'];
    }>(`SELECT id, slug, title, description, cuisine, servings, cook_time_minutes, difficulty
        FROM recipes ORDER BY id`);
    const ingredients = db.query<{
      recipe_id: string; ingredient_id: string; name: string; required_quantity: number;
      unit: Recipe['ingredients'][number]['unit']; is_optional: number;
    }>(`SELECT recipe_id, ingredient_id, name, required_quantity, unit, is_optional
        FROM recipe_ingredients ORDER BY recipe_id, id`);
    const steps = db.query<{
      recipe_id: string; step_number: number; instruction: string; tip: string | null;
      timer_minutes: number | null;
    }>(`SELECT recipe_id, step_number, instruction, tip, timer_minutes
        FROM recipe_steps ORDER BY recipe_id, step_number, id`);
    const recipes = rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      title: row.title,
      description: row.description ?? '',
      cuisine: row.cuisine,
      servings: row.servings,
      cookTimeMinutes: row.cook_time_minutes,
      difficulty: row.difficulty,
      imageUrl: '',
      ingredients: ingredients.filter((line) => line.recipe_id === row.id).map((line) => ({
        ingredientId: line.ingredient_id,
        name: line.name,
        requiredQuantity: line.required_quantity,
        unit: line.unit,
        isOptional: line.is_optional === 1,
      })),
      steps: steps.filter((step) => step.recipe_id === row.id).map((step) => ({
        stepNumber: step.step_number,
        instruction: step.instruction,
        ...(step.tip === null ? {} : { tip: step.tip }),
        ...(step.timer_minutes === null ? {} : { timerMinutes: step.timer_minutes }),
      })),
      tags: [],
    }) as Recipe);
    return createRecipeAuthoritySnapshot('d1', recipes, () => 0);
  };
}

/** An authority with no visible recipes: the planner universe is empty. */
export const emptyRecipeAuthority = async (): Promise<RecipeAuthoritySnapshot> => ({
  source: 'd1', fingerprint: '0'.repeat(64), loadedAt: 0, size: 0,
  list: () => [], findById: () => null, findByIdOrSlug: () => null,
});
