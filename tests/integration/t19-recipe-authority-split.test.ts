import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchWorker } from '../helpers/worker-fetch.mjs';
import { ALL_RECIPES } from '../../packages/recipes/src/data';
import { currentCatalogRelease, isRecipeCanaryTenant } from '../../packages/recipes/src/recipe-authority';
import { MealPlanDtoSchema, PlanShoppingDtoSchema } from '../../packages/domain/src/meal-planning-api';
import { PlanAlternativesDtoSchema } from '../../packages/domain/src/meal-planning-presentation';
import { resetRecipeAuthorityCacheForTests, resetRecipeAuthorityCountersForTests } from '../../src/worker/services/recipe-authority';
import { resetRecipeCatalogShadowThrottle } from '../../src/worker/services/recipe-catalog-shadow';
import type { Env } from '../../src/worker/types';
import { SESSION_COOKIE, sha256Hex } from '../../src/worker/utils/session';
import { SqliteD1 } from '../helpers/sqlite-d1';

vi.mock('../../src/worker/services/email', () => ({ sendEmail: vi.fn(), buildOtpEmail: vi.fn() }));

/**
 * T19 — ONE recipe authority for Recipe API, Meal Planner, Shopping and Cooking.
 *
 * Fixture: the real shipped ledger (static = 71 legacy recipes; D1 = the 500-recipe reviewed
 * release, so 429 recipes are D1-only). Every surface is driven through the real Worker for one
 * household under each RECIPE_CATALOG_MODE. The invariant under test: whatever the planner can
 * plan, suggest or swap in, the Recipe API can show and cooking can resolve — and vice versa.
 */
const ORIGIN = 'https://t19.example.test';
const release = currentCatalogRelease();
const STATIC_IDS = new Set(ALL_RECIPES.map((recipe) => recipe.id));
const D1_ONLY_IDS = release.orderedRecipeIds.filter((id) => !STATIC_IDS.has(id));
// Pilot recipe (Tôm xào bông cải xanh): D1-only relative to the 71 baseline and fully covered by STOCK below.
const D1_ONLY_COOKABLE = 'imp-26a36c69306143bc';
const CANDIDATES = Array.from({ length: 400 }, (_, index) => `t19-house-${index}`);
const INSIDE = CANDIDATES.find((id) => isRecipeCanaryTenant(id, 10))!;
const OUTSIDE = CANDIDATES.find((id) => !isRecipeCanaryTenant(id, 10))!;

type Mode = 'static' | 'shadow' | 'canary' | 'd1';
const MODE_ENV: Record<Mode, Partial<Env>> = {
  static: {},
  shadow: { RECIPE_CATALOG_MODE: 'shadow', RECIPE_CATALOG_SHADOW_INTERVAL_MS: '1000' },
  canary: { RECIPE_CATALOG_MODE: 'canary', RECIPE_CATALOG_CUTOVER_ENABLED: 'true', RECIPE_CATALOG_D1_CANARY_PERCENT: '10' },
  d1: { RECIPE_CATALOG_MODE: 'd1', RECIPE_CATALOG_CUTOVER_ENABLED: 'true' },
};

// A wide horizon so the V1 planner (recipeLimit 80, sorted by ID) is very likely to pick D1-only recipes.
const DATE = '2030-01-02';
const dates = Array.from({ length: 7 }, (_, index) => new Date(Date.parse(DATE) + index * 86_400_000).toISOString().slice(0, 10));
const intent = { startDate: DATE, horizonDays: 7, defaultServings: 2, mode: 'shopping_allowed', slots: dates.map((date) => ({ date, mealType: 'dinner' })) };

const STOCK = [
  ['CHICKEN_EGG', 'Trứng gà', 30, 'piece', 'egg'], ['TOMATO', 'Cà chua', 20, 'piece', 'vegetable'], ['SCALLION', 'Hành lá', 10, 'bunch', 'vegetable'],
  ['COOKING_OIL', 'Dầu ăn', 1000, 'ml', 'spice'], ['TOFU', 'Đậu phụ', 10, 'piece', 'vegetable'], ['SHRIMP', 'Tôm tươi', 1000, 'g', 'seafood'],
  ['BROCCOLI', 'Bông cải xanh', 5, 'piece', 'vegetable'], ['GARLIC', 'Tỏi', 20, 'piece', 'spice'], ['FISH_SAUCE', 'Nước mắm', 500, 'ml', 'spice'],
  ['RICE', 'Gạo', 5000, 'g', 'grain'], ['PORK_BELLY', 'Thịt ba chỉ', 2000, 'g', 'meat'],
] as const;

let db: SqliteD1;
let cookies: Record<string, string>;
let counter = 0;

async function seedHousehold(householdId: string) {
  counter += 1;
  const userId = `t19-user-${counter}`;
  db.seed(`INSERT INTO users (id, email, is_guest) VALUES ('${userId}', '${userId}@example.test', 0);
    INSERT INTO households (id, name, created_by) VALUES ('${householdId}', 'T19', '${userId}');
    INSERT INTO household_members (id, household_id, user_id, role) VALUES ('hm-${householdId}', '${householdId}', '${userId}', 'owner');
    INSERT INTO inventory_items (id, household_id, ingredient_id, name, quantity, unit, category, storage, freshness, data_source, version) VALUES
      ${STOCK.map(([id, name, qty, unit, category]) => `('t19-${id.toLowerCase()}-${householdId}', '${householdId}', '${id}', '${name}', ${qty}, '${unit}', '${category}', 'fridge', 'fresh', 'manual', 1)`).join(',\n')};`);
  const token = `t19-session-${householdId}-${counter}`;
  await db.prepare(`INSERT INTO sessions_v2 (id, user_id, household_id, token_hash, expires_at) VALUES (?, ?, ?, ?, '2099-01-01T00:00:00Z')`)
    .bind(`sess-${householdId}`, userId, householdId, await sha256Hex(token)).run();
  cookies[householdId] = `${SESSION_COOKIE}=${token}`;
}

function env(mode: Mode, extra: Partial<Env> = {}): Env {
  return { DB: db, APP_URL: ORIGIN, ENVIRONMENT: 'development', MEAL_PLANNER_ENABLED: 'true', ...MODE_ENV[mode], ...extra } as unknown as Env;
}

async function call(mode: Mode, householdId: string, method: 'GET' | 'POST', path: string, body?: unknown, extra: Partial<Env> = {}) {
  resetRecipeAuthorityCacheForTests();
  const headers: Record<string, string> = { Cookie: cookies[householdId], Origin: ORIGIN, 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() };
  const response = await fetchWorker(new Request(`${ORIGIN}/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env(mode, extra));
  const text = await response.text();
  let json: any = {};
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: response.status, json };
}

/** Every recipe identity a plan exposes to the user. */
function planRecipeIds(plan: unknown) {
  const dto = MealPlanDtoSchema.parse(plan);
  return [...new Set(dto.result.meals.filter((meal) => meal.source.kind === 'recipe').map((meal) => meal.source.id))];
}

beforeEach(async () => {
  db = new SqliteD1();
  cookies = {};
  await seedHousehold(INSIDE);
  await seedHousehold(OUTSIDE);
  resetRecipeAuthorityCacheForTests(); resetRecipeAuthorityCountersForTests(); resetRecipeCatalogShadowThrottle();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { db.close(); vi.restoreAllMocks(); resetRecipeAuthorityCacheForTests(); });

describe('T19 fixture truth', () => {
  it('static = 71 legacy recipes; the shipped D1 release adds 429 D1-only recipes', () => {
    expect(ALL_RECIPES).toHaveLength(71);
    expect(release.expectedRecipeCount).toBe(500);
    expect(D1_ONLY_IDS).toHaveLength(429);
    expect(D1_ONLY_IDS).toContain(D1_ONLY_COOKABLE);
    expect(db.query<{ n: number }>('SELECT COUNT(*) AS n FROM recipes')[0].n).toBe(500);
  });
});

describe('T19 — planner universe must equal Recipe API universe under every authority mode', () => {
  for (const [mode, householdId, expectD1] of [
    ['static', INSIDE, false], ['shadow', INSIDE, false], ['canary', OUTSIDE, false], ['canary', INSIDE, true], ['d1', INSIDE, true],
  ] as const) {
    it(`${mode}${mode === 'canary' ? (expectD1 ? ' (inside cohort)' : ' (outside cohort)') : ''}: generated plan, alternatives and swap only expose recipes the Recipe API and cooking resolve`, async () => {
      const list = await call(mode, householdId, 'GET', '/recipes');
      expect(list.status).toBe(200);
      const visible = new Set<string>(list.json.recipes.map((recipe: any) => recipe.id));
      expect(visible.size).toBe(expectD1 ? 500 : 71);

      const generated = await call(mode, householdId, 'POST', '/meal-planning/plans', intent);
      expect(generated.status, JSON.stringify(generated.json)).toBe(200);
      const planned = planRecipeIds(generated.json);
      expect(planned.length).toBeGreaterThan(0);
      // Recipe identity survives planner → recipe detail → cooking start, for EVERY planned recipe.
      for (const id of planned) {
        expect(visible.has(id), `planner selected ${id} which GET /recipes does not list under ${mode}`).toBe(true);
        expect((await call(mode, householdId, 'GET', `/recipes/${id}`)).status, `recipe detail ${id}`).toBe(200);
        expect((await call(mode, householdId, 'POST', `/recipes/${id}/cook/start`)).status, `cook start ${id}`).toBe(200);
      }
      const plan = MealPlanDtoSchema.parse(generated.json);

      const alternatives = await call(mode, householdId, 'GET', `/meal-planning/plans/${plan.id}/alternatives?revision=${plan.revision}`);
      expect(alternatives.status).toBe(200);
      const offered = PlanAlternativesDtoSchema.parse(alternatives.json).alternatives.map((entry) => entry.id);
      expect(offered.length).toBeGreaterThan(0);
      for (const id of offered) expect(visible.has(id), `alternative ${id} is not visible under ${mode}`).toBe(true);
      if (expectD1) expect(offered.some((id) => !STATIC_IDS.has(id))).toBe(true);

      // A D1-only replacement is legal exactly when D1 is the effective authority; otherwise it is a typed rejection.
      const d1Only = D1_ONLY_COOKABLE;
      const swap = await call(mode, householdId, 'POST', `/meal-planning/plans/${plan.id}/swap`, { revision: plan.revision, slotId: plan.result.meals[0].slotId, replacement: { kind: 'recipe', id: d1Only } });
      if (expectD1) {
        expect(swap.status, JSON.stringify(swap.json)).toBe(200);
        expect(MealPlanDtoSchema.parse(swap.json).result.meals[0].source.id).toBe(d1Only);
        expect((await call(mode, householdId, 'GET', `/recipes/${d1Only}`)).status).toBe(200);
      } else {
        expect(swap.status).toBe(422);
        expect(swap.json.code).toBe('REPLACEMENT_NOT_FOUND');
        expect((await call(mode, householdId, 'GET', `/recipes/${d1Only}`)).status).toBe(404);
        expect((await call(mode, householdId, 'POST', `/recipes/${d1Only}/cook/start`)).status).toBe(404);
      }
    });
  }

  it('static: the planned universe is exactly the legacy 71 and a static plan is not staled by an invisible D1-only change', async () => {
    const generated = await call('static', INSIDE, 'POST', '/meal-planning/plans', intent);
    expect(generated.status).toBe(200);
    const plan = MealPlanDtoSchema.parse(generated.json);
    expect(plan.freshness.status).toBe('fresh');
    for (const id of planRecipeIds(plan)) expect(STATIC_IDS.has(id)).toBe(true);
    db.seed(`UPDATE recipes SET title = title || ' (edited)' WHERE id = '${D1_ONLY_IDS[5]}'`);
    const reread = await call('static', INSIDE, 'GET', `/meal-planning/plans/${plan.id}`);
    expect(reread.status).toBe(200);
    expect(MealPlanDtoSchema.parse(reread.json).freshness.reasons).not.toContain('stale_catalog');
  });

  it('d1 readiness failure: Recipe API and Planner fall back to static TOGETHER (no split authority)', async () => {
    // A stray complete recipe beyond the release breaks D1 readiness (COUNT_DRIFT) for every surface.
    db.seed(`INSERT INTO recipes (id, slug, title, description, cuisine, cook_time_minutes, servings, difficulty, image_url, tags, source_type, source_reference, verification_state, version)
      VALUES ('imp-ffffffffffffffff', 'stray-extra', 'Stray', 'Stray extra row', 'thai', 10, 2, 'easy', '/frigo/illustrations/delicious-meal.png', '[]', 'ai_generated', 'stray', 'reviewed', 1);
      INSERT INTO recipe_ingredients (id, recipe_id, ingredient_id, name, required_quantity, unit, is_optional) VALUES ('imp-ffffffffffffffff_ing_1', 'imp-ffffffffffffffff', 'RICE', 'Gạo', 100, 'g', 0);
      INSERT INTO recipe_runtime_ingredient_order (recipe_ingredient_id, recipe_id, position) VALUES ('imp-ffffffffffffffff_ing_1', 'imp-ffffffffffffffff', 0);
      INSERT INTO recipe_steps (id, recipe_id, step_number, instruction) VALUES ('imp-ffffffffffffffff_step_1', 'imp-ffffffffffffffff', 1, 'Stray step');
      INSERT INTO recipe_runtime_fields (recipe_id, runtime_order) VALUES ('imp-ffffffffffffffff', ${release.expectedRecipeCount});`);
    for (const mode of ['d1', 'canary'] as const) {
      const list = await call(mode, INSIDE, 'GET', '/recipes');
      expect(list.json.recipes).toHaveLength(71);
      const generated = await call(mode, INSIDE, 'POST', '/meal-planning/plans', intent);
      expect(generated.status, JSON.stringify(generated.json)).toBe(200);
      for (const id of planRecipeIds(generated.json)) expect(STATIC_IDS.has(id), `${mode} fallback planner selected ${id}`).toBe(true);
      const plan = MealPlanDtoSchema.parse(generated.json);
      const alternatives = await call(mode, INSIDE, 'GET', `/meal-planning/plans/${plan.id}/alternatives?revision=${plan.revision}`);
      for (const entry of PlanAlternativesDtoSchema.parse(alternatives.json).alternatives) expect(STATIC_IDS.has(entry.id)).toBe(true);
      const swap = await call(mode, INSIDE, 'POST', `/meal-planning/plans/${plan.id}/swap`, { revision: plan.revision, slotId: plan.result.meals[0].slotId, replacement: { kind: 'recipe', id: D1_ONLY_COOKABLE } });
      expect(swap.status).toBe(422);
      expect(swap.json.code).toBe('REPLACEMENT_NOT_FOUND');
      expect((await call(mode, INSIDE, 'GET', `/recipes/${D1_ONLY_COOKABLE}`)).status).toBe(404);
      expect((await call(mode, INSIDE, 'POST', `/recipes/${D1_ONLY_COOKABLE}/cook/start`)).status).toBe(404);
    }
  });

  it('security: no request parameter, header or body field can choose the recipe authority', async () => {
    const spoof = { RECIPE_CATALOG_MODE: 'd1', RECIPE_CATALOG_CUTOVER_ENABLED: 'true', catalog: 'd1', authority: 'd1', recipeAuthority: { source: 'd1' } };
    const list = await call('static', INSIDE, 'GET', `/recipes?RECIPE_CATALOG_MODE=d1&authority=d1&catalog=d1`);
    expect(list.json.recipes).toHaveLength(71);
    const generated = await call('static', INSIDE, 'POST', '/meal-planning/plans', { ...intent, ...spoof });
    expect(generated.status).toBe(422); // strict intent contract rejects unknown authoritative fields
    const clean = await call('static', INSIDE, 'POST', '/meal-planning/plans', intent);
    const plan = MealPlanDtoSchema.parse(clean.json);
    const swap = await call('static', INSIDE, 'POST', `/meal-planning/plans/${plan.id}/swap`, { revision: plan.revision, slotId: plan.result.meals[0].slotId, replacement: { kind: 'recipe', id: D1_ONLY_COOKABLE }, ...spoof });
    expect([422]).toContain(swap.status);
    expect(db.query<{ revision: number }>('SELECT revision FROM generated_meal_plans WHERE id = ?', plan.id)[0].revision).toBe(1);
    // Cross-household: another household cannot read or swap this plan under any mode.
    for (const mode of ['static', 'd1'] as const) {
      expect((await call(mode, OUTSIDE, 'GET', `/meal-planning/plans/${plan.id}`)).status).toBe(404);
      expect((await call(mode, OUTSIDE, 'POST', `/meal-planning/plans/${plan.id}/swap`, { revision: 1, slotId: plan.result.meals[0].slotId, replacement: { kind: 'recipe', id: 'vn-canh-01' } })).status).toBe(404);
    }
  });

  it('d1: shopping and cooking accept a D1-only recipe the planner chose', async () => {
    const generated = await call('d1', INSIDE, 'POST', '/meal-planning/plans', intent);
    expect(generated.status).toBe(200);
    const plan = MealPlanDtoSchema.parse(generated.json);
    const d1Only = D1_ONLY_COOKABLE;
    const swap = await call('d1', INSIDE, 'POST', `/meal-planning/plans/${plan.id}/swap`, { revision: plan.revision, slotId: plan.result.meals[0].slotId, replacement: { kind: 'recipe', id: d1Only } });
    expect(swap.status, JSON.stringify(swap.json)).toBe(200);
    const swapped = MealPlanDtoSchema.parse(swap.json);
    const shopping = await call('d1', INSIDE, 'POST', `/meal-planning/plans/${plan.id}/shopping`, { revision: swapped.revision, currency: 'VND' });
    expect(shopping.status, JSON.stringify(shopping.json)).toBe(200);
    PlanShoppingDtoSchema.parse(shopping.json);
    const detail = await call('d1', INSIDE, 'GET', `/recipes/${d1Only}`);
    expect(detail.status).toBe(200);
    expect(detail.json.recipe.id).toBe(d1Only);
    const start = await call('d1', INSIDE, 'POST', `/recipes/${d1Only}/cook/start`);
    expect(start.status).toBe(200);
    expect(start.json.recipeId).toBe(d1Only);
    // Cooking complete recognizes the SAME identity and deducts through Inventory Truth (unchanged).
    const recipe = detail.json.recipe as { ingredients: Array<{ ingredientId: string; requiredQuantity: number }>; servings: number };
    const deductions = recipe.ingredients.map((line) => ({ ingredientId: line.ingredientId, quantityDeducted: line.requiredQuantity }));
    const eventsBefore = db.query<{ n: number }>('SELECT COUNT(*) AS n FROM inventory_events WHERE household_id = ?', INSIDE)[0].n;
    const complete = await call('d1', INSIDE, 'POST', `/recipes/${d1Only}/cook/complete`, { servings: recipe.servings, deductions });
    expect(complete.status, JSON.stringify(complete.json)).toBe(200);
    expect(complete.json).toMatchObject({ success: true, recipeId: d1Only });
    expect(db.query<{ n: number }>('SELECT COUNT(*) AS n FROM inventory_events WHERE household_id = ?', INSIDE)[0].n - eventsBefore).toBe(deductions.length);
    expect(db.query<{ recipe_id: string }>('SELECT recipe_id FROM cooked_meals WHERE household_id = ?', INSIDE)).toEqual([{ recipe_id: d1Only }]);
    // Static authority for the same household cannot cook that recipe: same 404 the Recipe API gives.
    expect((await call('static', INSIDE, 'POST', `/recipes/${d1Only}/cook/complete`, { servings: recipe.servings, deductions })).status).toBe(404);
  });
});
