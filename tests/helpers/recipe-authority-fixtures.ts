import type { RecipeAuthoritySnapshot } from '../../packages/recipes/src/recipe-authority';
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
    const rows = db.query<{ id: string; slug: string; title: string }>('SELECT id, slug, title FROM recipes ORDER BY id');
    const recipes = rows.map((row) => ({ id: row.id, slug: row.slug, title: row.title }) as unknown as Recipe);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(rows.map((row) => row.id))));
    const fingerprint = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    const byId = new Map(recipes.map((recipe) => [recipe.id, recipe]));
    const bySlug = new Map(recipes.map((recipe) => [recipe.slug, recipe]));
    return {
      source: 'd1', fingerprint, loadedAt: 0, size: recipes.length,
      list: () => [...recipes],
      findById: (id) => byId.get(id) ?? null,
      findByIdOrSlug: (idOrSlug) => byId.get(idOrSlug) ?? bySlug.get(idOrSlug) ?? null,
    };
  };
}

/** An authority with no visible recipes: the planner universe is empty. */
export const emptyRecipeAuthority = async (): Promise<RecipeAuthoritySnapshot> => ({
  source: 'd1', fingerprint: '0'.repeat(64), loadedAt: 0, size: 0,
  list: () => [], findById: () => null, findByIdOrSlug: () => null,
});
