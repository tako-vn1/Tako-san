import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMealPlanningSnapshot } from '../../packages/db/src/meal-planning-snapshot';
import { ALL_RECIPES } from '../../packages/recipes/src/data';
import { createRecipeAuthoritySnapshot, currentCatalogRelease } from '../../packages/recipes/src/recipe-authority';
import { readRecipeContent } from '../../packages/db/src/recipe-content';
import { hydrateRuntimeRecipes } from '../../packages/recipes/src/runtime-hydration';
import type { Recipe } from '../../packages/recipes/src/types';
import { MealPlanningApplicationService } from '../../src/worker/services/meal-planning';
import { MealPlanningError } from '../../src/worker/services/meal-planning-error';
import { SqliteD1 } from '../helpers/sqlite-d1';

/**
 * T19 — planner snapshot fingerprints and stored-plan authority identity.
 * The catalog fingerprint must depend only on the recipe universe visible under the EFFECTIVE
 * authority, and a persisted plan must carry the authority it was planned under so an authority
 * change is a typed revalidation, never a silent re-plan.
 */
const HOUSEHOLD = 't19-persist-home';
const USER = 't19-persist-user';
const NOW = '2029-12-31T00:00:00.000Z';
const release = currentCatalogRelease();
const STATIC_IDS = new Set(ALL_RECIPES.map((recipe) => recipe.id));
const D1_ONLY = release.orderedRecipeIds.find((id) => !STATIC_IDS.has(id))!;

let db: SqliteD1;
const scope = { householdId: HOUSEHOLD, userId: USER };
const staticAuthority = () => createRecipeAuthoritySnapshot('static', ALL_RECIPES);
const d1Authority = async () => createRecipeAuthoritySnapshot('d1', hydrateRuntimeRecipes(await readRecipeContent(db)).recipes as Recipe[]);

beforeEach(() => {
  db = new SqliteD1();
  db.seed(`INSERT INTO users (id) VALUES ('${USER}');
    INSERT INTO households (id, name, created_by) VALUES ('${HOUSEHOLD}', 'T19', '${USER}');
    INSERT INTO household_members (id, household_id, user_id, role) VALUES ('hm', '${HOUSEHOLD}', '${USER}', 'owner');
    INSERT INTO inventory_items (id, household_id, ingredient_id, name, quantity, unit, category, storage, freshness, version) VALUES
      ('eggs', '${HOUSEHOLD}', 'CHICKEN_EGG', 'Trứng', 30, 'piece', 'egg', 'fridge', 'fresh', 1),
      ('tomato', '${HOUSEHOLD}', 'TOMATO', 'Cà chua', 20, 'piece', 'vegetable', 'fridge', 'fresh', 1),
      ('shrimp', '${HOUSEHOLD}', 'SHRIMP', 'Tôm', 1000, 'g', 'seafood', 'fridge', 'fresh', 1);`);
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => { db.close(); vi.restoreAllMocks(); });

describe('authority-aware planner snapshot', () => {
  it('static authority: universe = 71 legacy recipes, source static, steps/nutrition fenced to the universe', async () => {
    const snapshot = await loadMealPlanningSnapshot(db, scope, NOW, await staticAuthority());
    expect(snapshot.catalog.source).toBe('static');
    expect(snapshot.catalog.recipes.map((recipe) => recipe.id).sort()).toEqual([...STATIC_IDS].sort());
    expect(snapshot.catalog.recipes.some((recipe) => recipe.id === D1_ONLY)).toBe(false);
    expect(snapshot.recipeSteps.every((step) => STATIC_IDS.has(step.recipeId))).toBe(true);
    expect(snapshot.recipeSteps.length).toBe(ALL_RECIPES.reduce((total, recipe) => total + recipe.steps.length, 0));
    expect(snapshot.authority).toEqual({ source: 'static', fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/), recipeCount: 71 });
    expect(snapshot.visibleRecipeIds.size).toBe(71);
    // Static content is the Recipe API content: exactly ALL_RECIPES' ingredient lines, not D1 rows.
    const canh = snapshot.catalog.recipes.find((recipe) => recipe.id === 'vn-canh-01')!;
    expect(canh.ingredients.map((line) => line.ingredientId)).toEqual(ALL_RECIPES.find((recipe) => recipe.id === 'vn-canh-01')!.ingredients.map((line) => line.ingredientId));
  });

  it('d1 authority: universe = the verified 500-recipe release with rich D1 facts (classifications, provenance)', async () => {
    const snapshot = await loadMealPlanningSnapshot(db, scope, NOW, await d1Authority());
    expect(snapshot.catalog.source).toBe('d1');
    expect(snapshot.catalog.recipes).toHaveLength(release.expectedRecipeCount);
    expect(snapshot.catalog.classifications.some((fact) => fact.recipeId === D1_ONLY && fact.kind === 'meal_type')).toBe(true);
    expect(snapshot.catalog.recipes.find((recipe) => recipe.id === D1_ONLY)!.provenance.sourceType).toBe('ai_generated');
    expect(snapshot.authority).toMatchObject({ source: 'd1', recipeCount: release.expectedRecipeCount });
  });

  it('static catalog fingerprint ignores a D1-only recipe change but tracks a visible recipe change', async () => {
    const before = await loadMealPlanningSnapshot(db, scope, NOW, await staticAuthority());
    db.seed(`UPDATE recipes SET title = title || ' (edited)' WHERE id = '${D1_ONLY}'; UPDATE recipe_steps SET instruction = instruction || '!' WHERE recipe_id = '${D1_ONLY}'`);
    const hiddenChange = await loadMealPlanningSnapshot(db, scope, NOW, await staticAuthority());
    expect(hiddenChange.fingerprint.parts.catalog).toBe(before.fingerprint.parts.catalog);
    expect(hiddenChange.fingerprint.value).toBe(before.fingerprint.value);
    // A visible planner fact (classification of a static recipe) changes the catalog part only.
    db.seed("INSERT INTO recipe_classifications (recipe_id, kind, tag) VALUES ('vn-canh-01', 'allergen', 'shellfish')");
    const visibleChange = await loadMealPlanningSnapshot(db, scope, NOW, await staticAuthority());
    expect(visibleChange.fingerprint.parts.catalog).not.toBe(before.fingerprint.parts.catalog);
    expect(visibleChange.fingerprint.parts.inventory).toBe(before.fingerprint.parts.inventory);
  });

  it('d1 catalog fingerprint tracks D1-visible changes', async () => {
    const before = await loadMealPlanningSnapshot(db, scope, NOW, await d1Authority());
    db.seed(`UPDATE recipe_steps SET instruction = instruction || '!' WHERE recipe_id = '${D1_ONLY}'`);
    const after = await loadMealPlanningSnapshot(db, scope, NOW, await d1Authority());
    expect(after.fingerprint.parts.catalog).not.toBe(before.fingerprint.parts.catalog);
  });

  it('static and d1 authorities yield different planner catalog fingerprints for the same database', async () => {
    const [s, d] = await Promise.all([loadMealPlanningSnapshot(db, scope, NOW, await staticAuthority()), loadMealPlanningSnapshot(db, scope, NOW, await d1Authority())]);
    expect(s.fingerprint.parts.catalog).not.toBe(d.fingerprint.parts.catalog);
    expect(s.fingerprint.parts.inventory).toBe(d.fingerprint.parts.inventory);
  });
});

describe('stored plan authority identity', () => {
  const intent = { startDate: '2030-01-02', horizonDays: 2, utcOffsetMinutes: 0, defaultServings: 2, mode: 'shopping_allowed' as const,
    slots: [{ date: '2030-01-02', mealType: 'dinner' as const, sequence: 0 }, { date: '2030-01-03', mealType: 'dinner' as const, sequence: 0 }] };
  const service = (authority: () => Promise<Awaited<ReturnType<typeof staticAuthority>>>) =>
    new MealPlanningApplicationService(db, { now: () => new Date(NOW), recipeAuthority: authority });

  it('persists the authority source/fingerprint/count with the plan and stays fresh under the same authority', async () => {
    const plan = await service(staticAuthority).generate(scope, intent, 'persist-key-0001');
    const stored = JSON.parse(db.query<{ source_json: string }>('SELECT source_json FROM generated_meal_plans')[0].source_json);
    expect(stored.version).toBe(1);
    expect(stored.data.authority).toEqual({ source: 'static', fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/), recipeCount: 71 });
    expect(Object.keys(stored.data).sort()).toEqual(['authority', 'catalog', 'history', 'inventory', 'preferences']);
    expect(plan.freshness.status).toBe('fresh');
    expect((await service(staticAuthority).get(scope, plan.id)).freshness.status).toBe('fresh');
  });

  it('an authority change is a typed revalidation: freshness names it, swap and shopping refuse, regenerate recovers', async () => {
    const plan = await service(staticAuthority).generate(scope, intent, 'persist-key-0002');
    const underD1 = service(d1Authority);
    const reread = await underD1.get(scope, plan.id);
    expect(reread.freshness.status).toBe('requires_revalidation');
    expect(reread.freshness.reasons).toContain('catalog_authority_changed');
    expect(reread.result).toEqual(plan.result); // historical plan data is untouched
    await expect(underD1.swap(scope, plan.id, { revision: 1, slotId: plan.result.meals[0].slotId, replacement: { kind: 'recipe', id: D1_ONLY } }))
      .rejects.toMatchObject({ code: 'CATALOG_AUTHORITY_CHANGED', status: 409 } satisfies Partial<MealPlanningError>);
    await expect(underD1.shopping(scope, plan.id, { revision: 1, currency: 'VND' }))
      .rejects.toMatchObject({ code: 'CATALOG_AUTHORITY_CHANGED', status: 409 });
    expect(db.query<{ revision: number }>('SELECT revision FROM generated_meal_plans')[0].revision).toBe(1);
    const regenerated = await underD1.regenerate(scope, plan.id, { revision: 1 });
    expect(regenerated.revision).toBe(2);
    expect(regenerated.freshness.status).toBe('fresh');
    expect(JSON.parse(db.query<{ source_json: string }>('SELECT source_json FROM generated_meal_plans')[0].source_json).data.authority.source).toBe('d1');
  });

  it('a lock on a recipe that is no longer visible is dropped on regenerate, never silently substituted in place', async () => {
    const underD1 = service(d1Authority);
    const plan = await underD1.generate(scope, intent, 'persist-key-0003');
    const swapped = await underD1.swap(scope, plan.id, { revision: 1, slotId: plan.result.meals[0].slotId, replacement: { kind: 'recipe', id: 'imp-26a36c69306143bc' } });
    expect(swapped.result.meals[0].source.id).toBe('imp-26a36c69306143bc');
    // Rollback to static: the D1-only lock cannot be honored.
    const underStatic = service(staticAuthority);
    const regenerated = await underStatic.regenerate(scope, plan.id, { revision: swapped.revision });
    expect(regenerated.result.meals.every((meal) => STATIC_IDS.has(meal.source.id))).toBe(true);
    expect(JSON.parse(db.query<{ intent_json: string }>('SELECT intent_json FROM generated_meal_plans')[0].intent_json).data.locks).toEqual([]);
  });

  it('plans persisted before T19 (no authority identity) still decode and revalidate through the catalog fingerprint', async () => {
    const plan = await service(staticAuthority).generate(scope, intent, 'persist-key-0004');
    db.seed(`UPDATE generated_meal_plans SET source_json = json_remove(source_json, '$.data.authority') WHERE id = '${plan.id}'`);
    const legacy = await service(d1Authority).get(scope, plan.id);
    expect(legacy.freshness.reasons).toContain('stale_catalog');
    expect(legacy.freshness.reasons).not.toContain('catalog_authority_changed');
  });
});
