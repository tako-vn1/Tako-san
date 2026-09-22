import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchWorker } from '../helpers/worker-fetch.mjs';
import { authMiddleware } from '../../src/worker/middleware/auth';
import { createMealPlanningRoutes } from '../../src/worker/routes/meal-planning';
import { MealPlanningApplicationService } from '../../src/worker/services/meal-planning';
import type { AuthContext, Env } from '../../src/worker/types';
import { SESSION_COOKIE, sha256Hex } from '../../src/worker/utils/session';
import { saveRankingPreferences } from '../../packages/db/src/personalization';
import { MealPlanDtoSchema, PlanShoppingDtoSchema, PlanFeedbackDtoSchema } from '../../packages/domain/src/meal-planning-api';
import type { PurchaseOption } from '../../packages/recipes/src/shopping-catalog';
import * as planner from '../../packages/recipes/src/weekly-planner';
import { createBarrier, SqliteD1 } from '../helpers/sqlite-d1';
import { ALL_RECIPES } from '../../packages/recipes/src/data';
import { fixtureRecipeAuthority } from '../helpers/recipe-authority-fixtures';

vi.mock('../../src/worker/services/email', () => ({
  sendEmail: vi.fn(), buildOtpEmail: vi.fn(),
}));

const ORIGIN = 'https://frigo.example.com';
const DATE = '2030-01-02';
const NEXT = '2030-01-03';
const SLOT = `${DATE}:dinner:0`;
const intent = { startDate: DATE, horizonDays: 2, defaultServings: 2, mode: 'shopping_allowed',
  slots: [{ date: DATE, mealType: 'dinner' }, { date: NEXT, mealType: 'dinner' }] };
let fixtureId = 0;
let db: SqliteD1;
let env: Env;
let scope: { householdId: string; userId: string };
let cookie: string;
let otherCookie: string;
let memberCookie: string;
let offers: PurchaseOption[];
let app: Hono<{ Bindings: Env; Variables: { auth: AuthContext } }>;

beforeEach(async () => {
  fixtureId += 1;
  db = new SqliteD1();
  scope = { householdId: `mp-home-${fixtureId}`, userId: `mp-user-${fixtureId}` };
  db.seed(`INSERT INTO users (id) VALUES ('${scope.userId}'), ('other-${fixtureId}'), ('member-${fixtureId}');
    INSERT INTO households (id, name, created_by) VALUES
      ('${scope.householdId}', 'Test home', '${scope.userId}'), ('other-home-${fixtureId}', 'Other home', 'other-${fixtureId}');
    INSERT INTO household_members (id, household_id, user_id, role) VALUES
      ('owner-${fixtureId}', '${scope.householdId}', '${scope.userId}', 'owner'),
      ('other-member-${fixtureId}', 'other-home-${fixtureId}', 'other-${fixtureId}', 'owner'),
      ('same-home-member-${fixtureId}', '${scope.householdId}', 'member-${fixtureId}', 'member');
    DELETE FROM recipes;
    INSERT INTO recipes (id, slug, title, cuisine, servings, prep_time_minutes, cook_time_minutes, difficulty)
      VALUES ('a-small', 'a-small', 'Small chicken meal', 'viet', 2, 0, 10, 'easy'),
        ('z-large', 'z-large', 'Large chicken meal', 'viet', 2, 0, 10, 'easy');
    INSERT INTO recipe_ingredients (id, recipe_id, ingredient_id, name, required_quantity, unit, is_optional)
      VALUES ('line-small', 'a-small', 'CHICKEN_BREAST', 'Chicken', 100, 'g', 0),
        ('line-large', 'z-large', 'CHICKEN_BREAST', 'Chicken', 400, 'g', 0);
    INSERT INTO recipe_steps (id, recipe_id, step_number, instruction) VALUES ('step-small', 'a-small', 1, 'Cook thoroughly.');
    INSERT INTO inventory_items (id, household_id, ingredient_id, name, quantity, unit, version)
      VALUES ('stock', '${scope.householdId}', 'CHICKEN_BREAST', 'Chicken', 500, 'g', 3);
  `);
  async function session(userId: string, householdId: string, label: string) {
    const token = `private-test-session-${label}-${fixtureId}`;
    await db.prepare(`INSERT INTO sessions_v2 (id, user_id, household_id, token_hash, expires_at)
      VALUES (?, ?, ?, ?, '2099-01-01T00:00:00Z')`)
      .bind(`${label}-${fixtureId}`, userId, householdId, await sha256Hex(token)).run();
    return `${SESSION_COOKIE}=${token}`;
  }
  cookie = await session(scope.userId, scope.householdId, 'owner-session');
  otherCookie = await session(`other-${fixtureId}`, `other-home-${fixtureId}`, 'other-session');
  memberCookie = await session(`member-${fixtureId}`, scope.householdId, 'member-session');
  env = { DB: db, APP_URL: ORIGIN, ENVIRONMENT: 'development', MEAL_PLANNER_ENABLED: 'true' };
  offers = [];
  app = new Hono();
  app.use('*', authMiddleware);
  app.route('/api/v1', createMealPlanningRoutes({ recipeAuthority: fixtureRecipeAuthority(db), purchaseCatalog: async (_scope, asOf) => ({
    snapshotId: 'reviewed-fixture', status: 'available',
    options: offers.map((offer) => ({ ...offer, price: offer.price ? { ...offer.price, asOf } : null })),
  }) }));
});
afterEach(() => { db.close(); vi.restoreAllMocks(); vi.useRealTimers(); });

async function request(path = '', body?: unknown, options: { cookie?: string | null; key?: string; headers?: Record<string, string>; realWorker?: boolean; raw?: string } = {}) {
  const headers = new Headers({ Origin: ORIGIN, 'Content-Type': 'application/json',
    'Idempotency-Key': options.key ?? 'request-default', ...options.headers });
  if (options.cookie !== null) headers.set('Cookie', options.cookie ?? cookie);
  const req = new Request(`${ORIGIN}/api/v1/meal-planning/plans${path}`, {
    method: body === undefined && options.raw === undefined ? 'GET' : 'POST', headers,
    body: options.raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  return options.realWorker ? fetchWorker(req, env) : app.fetch(req, env);
}
async function generate(body: unknown = intent) {
  const response = await request('', body);
  expect(response.status, await response.clone().text()).toBe(200);
  return MealPlanDtoSchema.parse(await response.json());
}
function inventoryState() {
  return { stock: db.query('SELECT * FROM inventory_items'), events: db.query('SELECT * FROM inventory_events'),
    cooked: db.query('SELECT * FROM cooked_meals'), legacyPlans: db.query('SELECT * FROM meal_plans') };
}

describe('T06A real authenticated Worker/API boundary', () => {
  it('generates and retrieves a safe DTO through the actual Worker without stock, AI or payment calls', async () => {
    const before = inventoryState();
    const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Outbound calls forbidden'));
    const planning = vi.spyOn(planner, 'planWeeklyMeals');
    const response = await request('', intent, { realWorker: true });
    expect(response.status, await response.clone().text()).toBe(200);
    const plan = MealPlanDtoSchema.parse(await response.json());
    expect(plan.result.status).toBe('feasible');
    expect(plan.revision).toBe(1);
    // T19: the real Worker plans from the recipe AUTHORITY (static 71 here), never from the synthetic D1 rows.
    expect(plan.result.meals.every((meal) => ALL_RECIPES.some((recipe) => recipe.id === meal.source.id))).toBe(true);
    expect(plan.result.meals[0].instructions.length).toBeGreaterThan(0);
    expect(planning).toHaveBeenCalledTimes(1);
    const retrieved = await request(`/${plan.id}`, undefined, { realWorker: true });
    expect(retrieved.status).toBe(200);
    expect(MealPlanDtoSchema.parse(await retrieved.json()).result).toEqual(plan.result);
    expect(planning).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(plan)).not.toMatch(/rankingContext|evidenceKey|sourceReference|token_hash|beam|userId/);
    expect(retrieved.headers.get('Cache-Control')).toBe('no-store');
    expect(inventoryState()).toEqual(before);
    expect(network).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated generation and reads', async () => {
    expect((await request('', intent, { cookie: null, realWorker: true })).status).toBe(401);
    expect((await request(`/${crypto.randomUUID()}`, undefined, { cookie: null, realWorker: true })).status).toBe(401);
  });

  it('protects CSRF, session owner fencing, membership and private creator plans', async () => {
    const plan = await generate();
    expect((await request('', intent, { headers: { Origin: 'https://evil.example' } })).status).toBe(403);
    expect((await request('', intent, { headers: { 'X-Frigo-Expected-User-Id': scope.userId, 'X-Frigo-Expected-Household-Id': `other-home-${fixtureId}` } })).status).toBe(403);
    for (const actor of [otherCookie, memberCookie]) {
      expect((await request(`/${plan.id}`, undefined, { cookie: actor })).status).toBe(404);
      expect((await request(`/${plan.id}/regenerate`, { revision: 1 }, { cookie: actor })).status).toBe(404);
      expect((await request(`/${plan.id}/swap`, { revision: 1, slotId: SLOT, replacement: { kind: 'recipe', id: 'z-large' } }, { cookie: actor })).status).toBe(404);
      expect((await request(`/${plan.id}/shopping`, { revision: 1, currency: 'JPY' }, { cookie: actor })).status).toBe(404);
      expect((await request(`/${plan.id}/feedback`, { revision: 1, slotId: SLOT, type: 'liked' }, { cookie: actor })).status).toBe(404);
    }
    db.seed(`DELETE FROM household_members WHERE user_id = '${scope.userId}'`);
    expect((await request('', intent)).status).toBe(403);
  });

  it.each(['mealPlan', 'shortages', 'prices', 'catalog', 'inventory', 'rankingContext', 'evidence', 'substitutions', 'householdId', 'userId', 'preferences'])(
    'rejects authoritative client %s in generation', async (field) => {
      const response = await request('', { ...intent, [field]: { verificationState: 'reviewed', amountMinor: 1 } });
      expect(response.status).toBe(422);
      expect(db.query('SELECT * FROM generated_meal_plans')).toEqual([]);
    },
  );

  it('enforces server household hard restrictions despite perfect personal soft preference and omission', async () => {
    await saveRankingPreferences(db, scope, { scope: 'household', values: { allergens: ['milk'], requiredDietaryTags: ['vegetarian'] }, updatedAt: new Date().toISOString() });
    await saveRankingPreferences(db, scope, { scope: 'user', values: { preferredCuisines: ['viet'], likedIngredientIds: ['CHICKEN_BREAST'] }, updatedAt: new Date().toISOString() });
    db.seed("INSERT INTO recipe_classifications (recipe_id, kind, tag) VALUES ('a-small', 'allergen', 'milk')");
    const plan = await generate();
    expect(plan.result.meals).toEqual([]);
    expect(plan.result.status).toBe('infeasible');
    expect(plan.result.conclusion).toBe('proven_infeasible');
    expect(plan.result.search.rejections.map((row) => row.code)).toEqual(expect.arrayContaining(['ALLERGEN_CONFLICT', 'SAFETY_UNKNOWN']));
  });

  it('deduplicates creation before running T04 again, and rejects different intent under a reused key', async () => {
    const planning = vi.spyOn(planner, 'planWeeklyMeals');
    const plan = await generate();
    const replay = await generate();
    expect(replay.id).toBe(plan.id);
    expect(planning).toHaveBeenCalledTimes(1);
    expect(db.query('SELECT * FROM generated_meal_plans')).toHaveLength(1);
    expect((await request('', { ...intent, defaultServings: 3 })).status).toBe(409);
  });

  it('replans all sequential stock after an early swap and protects newer revisions', async () => {
    const before = inventoryState();
    const plan = await generate();
    expect(plan.result.meals.map((meal) => meal.source.id)).toEqual(['a-small', 'z-large']);
    const response = await request(`/${plan.id}/swap`, { revision: 1, slotId: SLOT, replacement: { kind: 'recipe', id: 'z-large' } });
    expect(response.status, await response.clone().text()).toBe(200);
    const swapped = MealPlanDtoSchema.parse(await response.json());
    expect(swapped.revision).toBe(2);
    expect(swapped.result.meals.map((meal) => meal.source.id)).toEqual(['z-large', 'a-small']);
    expect(swapped.result.meals.map((meal) => meal.projectedConsumption[0].consumed.value)).toEqual(['400', '100']);
    expect(swapped.result.meals[1].projectedConsumption[0].remaining.value).toBe('0');
    expect((await request(`/${plan.id}/swap`, { revision: 1, slotId: SLOT, replacement: { kind: 'recipe', id: 'a-small' } })).status).toBe(409);
    expect((await request(`/${plan.id}/regenerate`, { revision: 1 })).status).toBe(409);
    expect((await request(`/${plan.id}/shopping`, { revision: 1, currency: 'JPY' })).status).toBe(409);
    expect(inventoryState()).toEqual(before);
  });

  it('rejects a newly forbidden replacement without changing the persisted plan', async () => {
    const plan = await generate();
    await saveRankingPreferences(db, scope, { scope: 'household', values: { neverRecommendRecipeIds: ['z-large'] }, updatedAt: new Date().toISOString() });
    expect((await request(`/${plan.id}/swap`, { revision: 1, slotId: SLOT, replacement: { kind: 'recipe', id: 'z-large' } })).status).toBe(422);
    expect(db.query<{ revision: number }>('SELECT revision FROM generated_meal_plans')[0].revision).toBe(1);
  });

  it('detects inventory/catalog/preference changes and regenerates using current data', async () => {
    const plan = await generate();
    db.seed("UPDATE inventory_items SET quantity = 50, version = version + 1 WHERE id = 'stock'");
    const stale = MealPlanDtoSchema.parse(await (await request(`/${plan.id}`)).json());
    expect(stale.freshness.reasons).toContain('stale_inventory');
    expect((await request(`/${plan.id}/shopping`, { revision: 1, currency: 'JPY' })).status).toBe(409);
    const regenerated = await request(`/${plan.id}/regenerate`, { revision: 1 });
    expect(regenerated.status, await regenerated.clone().text()).toBe(200);
    const next = MealPlanDtoSchema.parse(await regenerated.json());
    expect(next.revision).toBe(2);
    expect(next.freshness.status).toBe('fresh');
    expect(next.result.meals[0].requirements[0].missing?.value).toBe('50');
    expect(db.query<{ quantity: number }>("SELECT quantity FROM inventory_items WHERE id = 'stock'")[0].quantity).toBe(50);
  });

  it('revalidates history at the current time so later feedback makes a stored plan stale', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-01-01T10:00:00Z'));
    const plan = await generate();
    expect(plan.freshness.status).toBe('fresh');
    vi.setSystemTime(new Date('2030-01-01T10:01:00Z'));
    expect((await request(`/${plan.id}/feedback`, { revision: 1, slotId: SLOT, type: 'liked' })).status).toBe(200);
    const current = MealPlanDtoSchema.parse(await (await request(`/${plan.id}`)).json());
    expect(current.freshness.reasons).toEqual(['stale_history']);
    expect(current.freshness.checkedAt).toBe('2030-01-01T10:01:00.000Z');
    expect((await request(`/${plan.id}/shopping`, { revision: 1, currency: 'JPY' })).status).toBe(409);
  });

  it('keeps missing reviewed prices unknown and never converts them into free shopping', async () => {
    db.seed('DELETE FROM inventory_items');
    const before = inventoryState();
    // Generate and shop through the same (real Worker) authority so the stored plan's source identity matches.
    const generated = await request('', intent, { realWorker: true });
    expect(generated.status, await generated.clone().text()).toBe(200);
    const plan = MealPlanDtoSchema.parse(await generated.json());
    const response = await request(`/${plan.id}/shopping`, { revision: 1, currency: 'JPY', budget: { mode: 'hard', money: { currency: 'JPY', minorAmount: '100' } } }, { realWorker: true });
    expect(response.status, await response.clone().text()).toBe(200);
    const shopping = PlanShoppingDtoSchema.parse(await response.json());
    expect(shopping.catalogStatus).toBe('reviewed_catalog_unavailable');
    expect(shopping.result.cost.totalCost).toBeNull();
    expect(shopping.result.budget.status).toBe('unknown');
    expect(shopping.result.cost.unknownCostItemCount).toBeGreaterThan(0);
    expect(inventoryState()).toEqual(before);
  });

  it.each(['mealPlan', 'shortages', 'prices', 'catalog', 'shoppingContext'])(
    'rejects shopping %s spoofing and uses unchanged trusted exact prices', async (field) => {
      db.seed('DELETE FROM inventory_items');
      offers = [{ id: 'trusted-pack', ingredientId: 'CHICKEN_BREAST', packageContent: { quantity: 100, unit: 'g', sourceReference: 'reviewed-net-content' },
        price: { amountMinor: 9_007_199_254_740_991, currency: 'JPY', asOf: new Date().toISOString(), source: 'catalog', sourceReference: 'reviewed-price' }, availability: 'available', expiry: null }];
      const plan = await generate();
      const input = { revision: 1, currency: 'JPY' };
      expect((await request(`/${plan.id}/shopping`, { ...input, [field]: { amountMinor: 1, missingQuantity: 0 } })).status).toBe(422);
      const response = await request(`/${plan.id}/shopping`, input);
      expect(response.status, await response.clone().text()).toBe(200);
      const result = PlanShoppingDtoSchema.parse(await response.json()).result;
      expect(result.cost.knownCost.minorAmount).toBe('45035996273704955');
      expect(result.cost.totalCost?.minorAmount).toBe('45035996273704955');
      expect(result.budget).toHaveProperty('largestKnownCostDrivers');
    },
  );

  it('records household/user scoped retry-safe tastes and cooked annotation without real cooking', async () => {
    const plan = await generate();
    const before = inventoryState();
    const payload = { revision: 1, slotId: SLOT, type: 'liked' };
    const first = PlanFeedbackDtoSchema.parse(await (await request(`/${plan.id}/feedback`, payload, { key: 'like-key-001' })).json());
    const replay = PlanFeedbackDtoSchema.parse(await (await request(`/${plan.id}/feedback`, payload, { key: 'like-key-001' })).json());
    expect(replay).toEqual(first);
    expect(db.query('SELECT * FROM recipe_feedback_events')).toHaveLength(1);
    expect((await request(`/${plan.id}/feedback`, { ...payload, userId: 'other-user', householdId: 'other-household' })).status).toBe(422);
    expect((await request(`/${plan.id}/feedback`, { ...payload, type: 'disliked' }, { key: 'like-key-001' })).status).toBe(409);
    const cooked = { ...payload, type: 'cooked' };
    expect((await request(`/${plan.id}/feedback`, cooked, { key: 'cooked-key-001' })).status).toBe(200);
    expect((await request(`/${plan.id}/feedback`, cooked, { key: 'cooked-key-001' })).status).toBe(200);
    expect(db.query('SELECT * FROM generated_meal_plan_annotations')).toHaveLength(1);
    expect(db.query('SELECT * FROM recipe_feedback_events')).toHaveLength(1);
    expect(inventoryState()).toEqual(before);
  });

  it('does not let a client claim a swap that never happened', async () => {
    const plan = await generate();
    expect((await request(`/${plan.id}/feedback`, { revision: 1, slotId: SLOT, type: 'swapped' })).status).toBe(422);
  });

  it('rejects feedback if regeneration advances the revision before the event write', async () => {
    const plan = await generate();
    let raced = false;
    db.hooks.beforeStatement = async ({ sql }) => {
      if (!raced && /INSERT\s+(?:OR IGNORE\s+)?INTO recipe_feedback_events/i.test(sql)) {
        raced = true;
        await new MealPlanningApplicationService(db, { recipeAuthority: fixtureRecipeAuthority(db) }).regenerate(scope, plan.id, { revision: 1 });
      }
    };
    const response = await request(`/${plan.id}/feedback`, { revision: 1, slotId: SLOT, type: 'liked' }, { key: 'racing-feedback' });
    expect(raced).toBe(true);
    expect(response.status).toBe(409);
    expect(db.query('SELECT * FROM recipe_feedback_events')).toEqual([]);
    expect(db.query<{ revision: number }>('SELECT revision FROM generated_meal_plans')[0].revision).toBe(2);
  });

  it('deduplicates concurrent feedback retries with one server event timestamp', async () => {
    const plan = await generate();
    const barrier = createBarrier(2);
    db.hooks.beforeStatement = async ({ sql }) => {
      if (/INSERT INTO recipe_feedback_events/i.test(sql)) await barrier.wait();
    };
    const payload = { revision: 1, slotId: SLOT, type: 'liked' };
    const responses = await Promise.all([
      request(`/${plan.id}/feedback`, payload, { key: 'concurrent-feedback' }),
      request(`/${plan.id}/feedback`, payload, { key: 'concurrent-feedback' }),
    ]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    const receipts = await Promise.all(responses.map(async (response) => PlanFeedbackDtoSchema.parse(await response.json())));
    expect(receipts[0]).toEqual(receipts[1]);
    expect(db.query('SELECT * FROM recipe_feedback_events')).toHaveLength(1);
  });

  it('records skipped/disliked and a server-established swapped identity without inventing likes', async () => {
    const plan = await generate();
    for (const type of ['skipped', 'disliked']) {
      expect((await request(`/${plan.id}/feedback`, { revision: 1, slotId: SLOT, type }, { key: `event-${type}` })).status).toBe(200);
    }
    const swap = await request(`/${plan.id}/swap`, { revision: 1, slotId: SLOT, replacement: { kind: 'recipe', id: 'z-large' } });
    expect(swap.status).toBe(200);
    expect((await request(`/${plan.id}/feedback`, { revision: 2, slotId: SLOT, type: 'swapped' }, { key: 'event-swapped' })).status).toBe(200);
    expect(db.query('SELECT event_type, target_recipe_id, replacement_recipe_id FROM recipe_feedback_events WHERE event_type = ?', 'swapped'))
      .toEqual([{ event_type: 'swapped', target_recipe_id: 'a-small', replacement_recipe_id: 'z-large' }]);
    expect(db.query("SELECT * FROM recipe_feedback_events WHERE event_type IN ('liked','cooked')")).toEqual([]);
  });

  it('returns a partial plan as a valid application response', async () => {
    db.seed("DELETE FROM recipes WHERE id = 'z-large'; UPDATE inventory_items SET quantity = 100");
    const plan = await generate({ ...intent, mode: 'cook_now' });
    expect(plan.result.status).toBe('partial');
    expect(plan.result.meals).toHaveLength(1);
    expect(plan.result.unplannedSlots).toHaveLength(1);
    expect(plan.result.conclusion).toBe('proven_infeasible');
  });

  it('preserves incomplete numeric evaluation without claiming proven infeasibility or a server failure', async () => {
    db.seed("DELETE FROM recipes WHERE id = 'z-large'; UPDATE recipes SET servings = 20; UPDATE recipe_ingredients SET required_quantity = 5e-324");
    const plan = await generate({ ...intent, defaultServings: 1 });
    expect(plan.result.status).toBe('incomplete');
    expect(plan.result.conclusion).toBe('no_plan_found_without_proof');
    expect(plan.result.search.exhaustive).toBe(false);
    expect(plan.result.search.incompleteReasons.length).toBeGreaterThan(0);
  });

  it('preserves search truncation while returning a feasible best-found plan', async () => {
    for (let index = 0; index < 81; index += 1) {
      await db.prepare(`INSERT INTO recipes (id, slug, title, cuisine, servings, prep_time_minutes, cook_time_minutes, difficulty)
        VALUES (?, ?, 'Candidate', 'viet', 2, 0, 10, 'easy')`).bind(`extra-${index}`, `extra-${index}`).run();
      await db.prepare(`INSERT INTO recipe_ingredients (id, recipe_id, ingredient_id, name, required_quantity, unit, is_optional)
        VALUES (?, ?, 'CHICKEN_BREAST', 'Chicken', 100, 'g', 0)`).bind(`extra-line-${index}`, `extra-${index}`).run();
    }
    const plan = await generate({ ...intent, slots: [intent.slots[0]] });
    expect(plan.result.status).toBe('feasible');
    expect(plan.result.search.truncated).toBe(true);
    expect(plan.result.search.exhaustive).toBe(false);
  });

  it('validates malformed JSON, dates, money, revisions and oversized bodies', async () => {
    expect((await request('', undefined, { raw: '{bad' })).status).toBe(400);
    expect((await request('', { ...intent, startDate: '2030-02-31' })).status).toBe(422);
    expect((await request('', { ...intent, slots: [intent.slots[0], intent.slots[0]] })).status).toBe(422);
    expect((await request('', undefined, { raw: `{"x":"${'x'.repeat(66_000)}"}` })).status).toBe(413);
    expect((await request('/not-a-uuid')).status).toBe(422);
    const plan = await generate();
    expect((await request(`/${plan.id}/shopping`, { revision: 0, currency: 'JPY' })).status).toBe(422);
    expect((await request(`/${plan.id}/shopping`, { revision: 1, currency: 'JPY', budget: { mode: 'hard', money: { currency: 'JPY', minorAmount: '9007199254740992' } } })).status).toBe(422);
  });

  it('rate limits expensive operations and remains opt-in', async () => {
    env.MEAL_PLANNER_ENABLED = 'false';
    expect((await request('', intent)).status).toBe(404);
    env.MEAL_PLANNER_ENABLED = 'true';
    for (let index = 0; index < 10; index += 1) expect((await request('', { ...intent, prices: [] })).status).toBe(422);
    const limited = await request('', intent);
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBeTruthy();
  });

  it.each(['not-money', '1.5', '-1', '01', 'Infinity'])(
    'rejects malformed minor-unit string %s without a server error', async (minorAmount) => {
      const plan = await generate();
      const response = await request(`/${plan.id}/shopping`, {
        revision: 1, currency: 'JPY', budget: { mode: 'hard', money: { currency: 'JPY', minorAmount } },
      });
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ code: 'INVALID_REQUEST' });
    },
  );

  it('sanitizes unexpected service errors even outside production', async () => {
    vi.spyOn(MealPlanningApplicationService.prototype, 'generate').mockRejectedValue(new Error('secret SQL and private stack'));
    const response = await request('', intent, { realWorker: true });
    expect(response.status).toBe(500);
    expect(await response.text()).not.toMatch(/SQL|secret|stack/);
  });
});
