import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SqliteD1 } from '../helpers/sqlite-d1';
import { fetchWorker } from '../helpers/worker-fetch.mjs';
import { createPreviewCache, issuePreviewSession, seedPlannerPreview } from '../../scripts/planner-preview-fixtures.mjs';
import { MealPlanDtoSchema, PlanShoppingDtoSchema } from '../../packages/domain/src/meal-planning-api';
import { createRecipeAuthoritySnapshot } from '../../packages/recipes/src/recipe-authority';
import * as authority from '../../src/worker/services/recipe-authority';

vi.mock('../../src/worker/services/email', () => ({ sendEmail: vi.fn(), buildOtpEmail: vi.fn() }));
const origin = 'https://t07-operations.example.test';
const prefix = '/api/v1/meal-planning/plans';
const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
const dates = Array.from({ length: 7 }, (_, index) =>
  new Date(Date.parse(tomorrow) + index * 86_400_000).toISOString().slice(0, 10));
const intent = { startDate: tomorrow, horizonDays: 7, utcOffsetMinutes: 0, defaultServings: 2,
  mode: 'shopping_allowed', slots: dates.map((date) => ({ date, mealType: 'dinner' })) };
let db;
let env;
let cookie;
beforeEach(() => {
  db = new SqliteD1();
  seedPlannerPreview(db);
  cookie = issuePreviewSession(db).split(';')[0];
  env = { DB: db, CACHE: createPreviewCache(), APP_URL: origin, ENVIRONMENT: 'development', MEAL_PLANNER_ENABLED: 'true' };
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('External calls forbidden'));
});
afterEach(() => { db.close(); vi.restoreAllMocks(); });
const request = (suffix, body) => fetchWorker(new Request(`${origin}${prefix}${suffix}`, {
  method: body === undefined ? 'GET' : 'POST',
  headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
  body: body === undefined ? undefined : JSON.stringify(body),
}), env);

describe('T07 real Worker operational observations', () => {
  it('records bounded representative flow observations without performance thresholds', async () => {
    const inventoryState = () => ({ lots: db.query('SELECT * FROM inventory_items ORDER BY id'),
      events: db.query('SELECT * FROM inventory_events ORDER BY id') });
    const beforeInventory = inventoryState();
    const records = [];
    const events = [];
    const originalLog = console.log;
    vi.spyOn(console, 'log').mockImplementation((message) => {
      if (typeof message === 'string' && message.startsWith('{')) events.push(JSON.parse(message));
    });
    const measure = async (name, suffix, body) => {
      let statements = 0;
      let batches = 0;
      db.hooks = { beforeStatement: () => { statements++; }, beforeBatch: (items) => { batches++; statements += items.length; } };
      events.length = 0;
      const start = performance.now();
      const response = await request(suffix, body);
      const text = await response.text();
      const wallMs = Math.round((performance.now() - start) * 100) / 100;
      expect(response.status, text).toBe(200);
      const data = JSON.parse(text);
      records.push({ name, wallMs, statements, batches, bytes: Buffer.byteLength(text),
        plannerStates: events.find((event) => event.event === 'meal_planning_result')?.states ?? null });
      expect(text).not.toContain(cookie.split('=')[1]);
      return data;
    };
    const generated = MealPlanDtoSchema.parse(await measure('generate', '', intent));
    expect(generated.result.meals).toHaveLength(7);
    const regenerated = MealPlanDtoSchema.parse(await measure('regenerate', `/${generated.id}/regenerate`, { revision: 1 }));
    const meal = regenerated.result.meals[0];
    // T19: swap targets come from the authority-fenced alternatives, never from an out-of-band recipe ID.
    const alternatives = await measure('alternatives', `/${generated.id}/alternatives?revision=2`);
    const id = alternatives.alternatives.find((entry) => entry.id !== meal.source.id).id;
    const swapped = MealPlanDtoSchema.parse(await measure('swap', `/${generated.id}/swap`, {
      revision: 2, slotId: meal.slotId, replacement: { kind: 'recipe', id },
    }));
    expect(swapped.revision).toBe(3);
    const shopping = PlanShoppingDtoSchema.parse(await measure('shopping', `/${generated.id}/shopping`, { revision: 3, currency: 'JPY' }));
    expect(shopping.catalogStatus).toBe('reviewed_catalog_unavailable');
    expect(shopping.result.cost.totalCost).toBeNull();
    const current = await measure('current', '/current');
    expect(current.plan.id).toBe(generated.id);
    expect(current.plan.revision).toBe(3);
    expect(inventoryState()).toEqual(beforeInventory);
    originalLog(`T07_OPERATION_OBSERVATIONS ${JSON.stringify(records)}`);
  }, 30_000);

  it('sanitizes a catalog database failure without returning private SQL or partial success', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    db.hooks.beforeBatch = (items) => {
      if (items.some((item) => item.sql.includes('FROM recipes'))) throw new Error('private SQL/catalog sentinel');
    };
    const response = await request('', intent);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ code: 'MEAL_PLANNING_UNAVAILABLE', error: 'Meal planning could not be completed' });
    expect(JSON.stringify(error.mock.calls)).not.toContain('private SQL/catalog sentinel');
    expect(db.query('SELECT * FROM generated_meal_plans')).toEqual([]);
  });

  it('reports an empty catalog honestly instead of inventing a fallback plan', async () => {
    // T19: the planner universe is the recipe AUTHORITY, not the raw D1 table. An empty D1 table under
    // static authority still plans from the 71 static recipes; an empty authority yields no meals.
    db.seed('DELETE FROM recipes');
    const staticStill = await request('', intent);
    expect(staticStill.status).toBe(200);
    expect(MealPlanDtoSchema.parse(await staticStill.json()).result.meals.length).toBeGreaterThan(0);
    vi.spyOn(authority, 'resolveRecipeAuthority').mockImplementation(async () => ({
      snapshot: await createRecipeAuthoritySnapshot('static', []), configuredMode: 'static', selectedSource: 'static',
      actualSource: 'static', canaryTenant: false, canaryAssignmentReason: null, fallbackReason: null, diagnostics: [],
    }));
    const response = await request('', intent);
    expect(response.status).toBe(200);
    const plan = MealPlanDtoSchema.parse(await response.json());
    expect(plan.result.meals).toEqual([]);
    expect(plan.result.status).toBe('infeasible');
    expect(plan.result.unplannedSlots).toHaveLength(7);
  });
});
