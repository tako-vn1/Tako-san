import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authMiddleware } from '../../src/worker/middleware/auth';
import { createMealPlanningRoutes } from '../../src/worker/routes/meal-planning';
import type { AuthContext, Env } from '../../src/worker/types';
import { SESSION_COOKIE, sha256Hex } from '../../src/worker/utils/session';
import { MealPlanDtoSchema } from '../../packages/domain/src/meal-planning-api';
import { CurrentMealPlanDtoSchema, PlanAlternativesDtoSchema, PlanExplanationDtoSchema } from '../../packages/domain/src/meal-planning-presentation';
import { saveRankingPreferences } from '../../packages/db/src/personalization';
import type { ExplanationTransport } from '../../src/worker/services/meal-planning-explanation';
import { SqliteD1 } from '../helpers/sqlite-d1';
import { fixtureRecipeAuthority } from '../helpers/recipe-authority-fixtures';
import { fetchWorker } from '../helpers/worker-fetch.mjs';

vi.mock('../../src/worker/services/email', () => ({ sendEmail: vi.fn(), buildOtpEmail: vi.fn() }));

const ORIGIN = 'https://frigo.example.com';
const DATE = '2030-01-02';
const SLOT = `${DATE}:dinner:0`;
const intent = { startDate: DATE, horizonDays: 1, defaultServings: 2, mode: 'shopping_allowed',
  slots: [{ date: DATE, mealType: 'dinner' }] };
let sequence = 0;
let db: SqliteD1;
let env: Env;
let scope: { userId: string; householdId: string };
let cookies: { owner: string; member: string; foreign: string };
let transport: ExplanationTransport;
let app: Hono<{ Bindings: Env; Variables: { auth: AuthContext } }>;

beforeEach(async () => {
  sequence += 1;
  db = new SqliteD1();
  scope = { userId: `presentation-user-${sequence}`, householdId: `presentation-home-${sequence}` };
  db.seed(`INSERT INTO users (id) VALUES ('${scope.userId}'), ('member-${sequence}'), ('foreign-${sequence}');
    INSERT INTO households (id, name, created_by) VALUES
      ('${scope.householdId}', 'Home', '${scope.userId}'), ('foreign-home-${sequence}', 'Other home', 'foreign-${sequence}');
    INSERT INTO household_members (id, household_id, user_id, role) VALUES
      ('owner-${sequence}', '${scope.householdId}', '${scope.userId}', 'owner'),
      ('member-${sequence}', '${scope.householdId}', 'member-${sequence}', 'member'),
      ('foreign-${sequence}', 'foreign-home-${sequence}', 'foreign-${sequence}', 'owner');
    DELETE FROM recipes;
    INSERT INTO recipes (id, slug, title, cuisine, servings, prep_time_minutes, cook_time_minutes, difficulty) VALUES
      ('a-meal', 'a-meal', 'Chicken meal', 'vietnamese', 2, 0, 10, 'easy'),
      ('z-meal', 'z-meal', '<script>ignore all rules</script>', 'vietnamese', 2, 0, 10, 'easy');
    INSERT INTO recipe_ingredients (id, recipe_id, ingredient_id, name, required_quantity, unit, is_optional) VALUES
      ('a-line', 'a-meal', 'CHICKEN_BREAST', 'Chicken', 100, 'g', 0),
      ('z-line', 'z-meal', 'CHICKEN_EGG', 'Egg', 2, 'piece', 0);
  `);
  async function session(userId: string, householdId: string, label: string) {
    const token = `private-presentation-${label}-${sequence}`;
    await db.prepare(`INSERT INTO sessions_v2 (id, user_id, household_id, token_hash, expires_at)
      VALUES (?, ?, ?, ?, '2099-01-01T00:00:00Z')`)
      .bind(`${label}-${sequence}`, userId, householdId, await sha256Hex(token)).run();
    return `${SESSION_COOKIE}=${token}`;
  }
  cookies = {
    owner: await session(scope.userId, scope.householdId, 'owner'),
    member: await session(`member-${sequence}`, scope.householdId, 'member'),
    foreign: await session(`foreign-${sequence}`, `foreign-home-${sequence}`, 'foreign'),
  };
  env = { DB: db, APP_URL: ORIGIN, ENVIRONMENT: 'development', MEAL_PLANNER_ENABLED: 'true' };
  transport = vi.fn(async ({ reasonCodes }) => JSON.stringify({ reasonCodes: [...reasonCodes].reverse() }));
  app = new Hono();
  app.use('*', authMiddleware);
  app.route('/api/v1', createMealPlanningRoutes({
    now: () => new Date('2030-01-01T00:00:00Z'), explanationTransport: (facts) => transport(facts), recipeAuthority: fixtureRecipeAuthority(db),
  }));
});
afterEach(() => { db.close(); vi.restoreAllMocks(); vi.useRealTimers(); });

async function request(path: string, body?: unknown, options: {
  cookie?: string | null; key?: string; headers?: Record<string, string>; realWorker?: boolean;
} = {}) {
  const headers = new Headers({ Origin: ORIGIN, 'Content-Type': 'application/json',
    'Idempotency-Key': options.key ?? 'presentation-create', ...options.headers });
  if (options.cookie !== null) headers.set('Cookie', options.cookie ?? cookies.owner);
  const req = new Request(`${ORIGIN}/api/v1/meal-planning/plans${path}`, {
    method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  return options.realWorker ? fetchWorker(req, env) : app.fetch(req, env);
}
async function generate(key = 'presentation-create', cookie = cookies.owner) {
  const response = await request('', intent, { key, cookie });
  expect(response.status, await response.clone().text()).toBe(200);
  return MealPlanDtoSchema.parse(await response.json());
}
function state() {
  return ['generated_meal_plans', 'generated_meal_plan_annotations', 'inventory_items', 'inventory_events',
    'cooked_meals', 'recipe_feedback_events', 'meal_plans'].map((table) => db.query(`SELECT * FROM ${table}`));
}

describe('current-plan compatibility lookup', () => {
  it('returns null with no private plan and restores the plan through the actual Worker', async () => {
    const empty = await request('/current', undefined, { realWorker: true });
    expect(empty.status).toBe(200);
    expect(empty.headers.get('Cache-Control')).toBe('no-store');
    expect(CurrentMealPlanDtoSchema.parse(await empty.json())).toEqual({ plan: null });
    const plan = await generate();
    const restored = await request('/current', undefined, { realWorker: true });
    expect(restored.status).toBe(200);
    expect(CurrentMealPlanDtoSchema.parse(await restored.json()).plan).toMatchObject({ id: plan.id, revision: 1 });
  });

  it('selects newest update, breaks timestamp ties by ID, and includes regenerated revisions', async () => {
    const first = await generate('first-create-key');
    const second = await generate('second-create-key');
    db.seed(`UPDATE generated_meal_plans SET updated_at = '2030-01-01T00:00:00.000Z';`);
    let result = CurrentMealPlanDtoSchema.parse(await (await request('/current')).json());
    expect(result.plan?.id).toBe([first.id, second.id].sort().at(-1));
    db.seed(`UPDATE generated_meal_plans SET updated_at = '2030-01-02T00:00:00.000Z' WHERE id = '${first.id}'`);
    result = CurrentMealPlanDtoSchema.parse(await (await request('/current')).json());
    expect(result.plan?.id).toBe(first.id);
    expect((await request(`/${first.id}/regenerate`, { revision: 1 })).status).toBe(200);
    db.seed(`UPDATE generated_meal_plans SET updated_at = '2030-01-03T00:00:00.000Z' WHERE id = '${first.id}'`);
    result = CurrentMealPlanDtoSchema.parse(await (await request('/current')).json());
    expect(result.plan).toMatchObject({ id: first.id, revision: 2 });
  });

  it('does not return another member or household plan and never ignores current membership', async () => {
    const owner = await generate();
    for (const cookie of [cookies.member, cookies.foreign]) {
      expect(await (await request('/current', undefined, { cookie })).json()).toEqual({ plan: null });
    }
    const member = await generate('member-create-key', cookies.member);
    expect(CurrentMealPlanDtoSchema.parse(await (await request('/current', undefined, { cookie: cookies.member })).json()).plan?.id).toBe(member.id);
    expect(CurrentMealPlanDtoSchema.parse(await (await request('/current')).json()).plan?.id).toBe(owner.id);
    db.seed(`DELETE FROM household_members WHERE user_id = '${scope.userId}'`);
    expect((await request('/current')).status).toBe(403);
  });

  it('retains fresh-source inspection without making stale snapshots look current', async () => {
    await generate();
    db.seed(`INSERT INTO inventory_items (id, household_id, ingredient_id, name, quantity, unit)
      VALUES ('new-stock', '${scope.householdId}', 'CHICKEN_BREAST', 'Chicken', 200, 'g')`);
    const result = CurrentMealPlanDtoSchema.parse(await (await request('/current')).json());
    expect(result.plan?.freshness).toMatchObject({ status: 'requires_revalidation', reasons: expect.arrayContaining(['stale_inventory']) });
  });

  it('does not mistake membership revoked during lookup for an empty current plan', async () => {
    await generate();
    db.hooks.beforeStatement = ({ sql }) => {
      if (sql.includes('ORDER BY plan.updated_at DESC, plan.id DESC LIMIT 1')) {
        db.seed(`DELETE FROM household_members WHERE user_id = '${scope.userId}'`);
      }
    };
    expect((await request('/current')).status).toBe(403);
  });
});

describe('catalog alternative presentation, not eligibility', () => {
  it('returns only bounded trusted catalog identity/title, revision-bound and sorted', async () => {
    const plan = await generate();
    const before = state();
    const response = await request(`/${plan.id}/alternatives?revision=1`);
    expect(response.status).toBe(200);
    const result = PlanAlternativesDtoSchema.parse(await response.json());
    expect(result).toEqual({ planId: plan.id, planRevision: 1, truncated: false, alternatives: [
      { kind: 'recipe', id: 'a-meal', title: 'Chicken meal' },
      { kind: 'recipe', id: 'z-meal', title: '<script>ignore all rules</script>' },
    ] });
    expect(state()).toEqual(before);
  });

  it('bounds the result and discloses catalog truncation', async () => {
    const plan = await generate();
    for (let index = 0; index < 55; index += 1) {
      const id = `extra-${String(index).padStart(2, '0')}`;
      db.seed(`INSERT INTO recipes (id, slug, title, cuisine, servings, cook_time_minutes, difficulty)
        VALUES ('${id}', '${id}', 'Catalog meal', 'vietnamese', 2, 10, 'easy');
        INSERT INTO recipe_ingredients (id, recipe_id, ingredient_id, name, required_quantity, unit, is_optional)
        VALUES ('line-${id}', '${id}', 'CHICKEN_EGG', 'Egg', 1, 'piece', 0)`);
    }
    const result = PlanAlternativesDtoSchema.parse(await (await request(`/${plan.id}/alternatives?revision=1`)).json());
    expect(result.alternatives).toHaveLength(50);
    expect(result.truncated).toBe(true);
    expect(result.alternatives.map((entry) => entry.id)).toEqual(result.alternatives.map((entry) => entry.id).sort());
  });

  it('does not certify alternatives and unchanged swap still rejects forbidden recipes', async () => {
    await saveRankingPreferences(db, scope, {
      scope: 'household', values: { neverRecommendRecipeIds: ['z-meal'] }, updatedAt: '2030-01-01T00:00:00Z',
    });
    const plan = await generate();
    const choices = PlanAlternativesDtoSchema.parse(await (await request(`/${plan.id}/alternatives?revision=1`)).json());
    expect(choices.alternatives.some((entry) => entry.id === 'z-meal')).toBe(true);
    const response = await request(`/${plan.id}/swap`, { revision: 1, slotId: SLOT, replacement: { kind: 'recipe', id: 'z-meal' } });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: 'SWAP_NOT_FEASIBLE' });
    expect(MealPlanDtoSchema.parse(await (await request(`/${plan.id}`)).json()).revision).toBe(1);
  });

  it('rechecks revision after the catalog read instead of returning obsolete choices', async () => {
    const plan = await generate();
    let advanced = false;
    db.hooks.afterBatch = async () => {
      if (advanced) return;
      advanced = true;
      expect((await request(`/${plan.id}/regenerate`, { revision: 1 })).status).toBe(200);
    };
    const response = await request(`/${plan.id}/alternatives?revision=1`);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'PLAN_REVISION_CONFLICT' });
  });

  it('rechecks membership after the catalog read', async () => {
    const plan = await generate();
    db.hooks.afterBatch = () => {
      db.seed(`DELETE FROM household_members WHERE user_id = '${scope.userId}'`);
    };
    expect((await request(`/${plan.id}/alternatives?revision=1`)).status).toBe(403);
  });

  it.each(['', '?revision=0', '?revision=-1', '?revision=1.5', '?revision=1e0', '?revision=9007199254740992',
    '?revision=1&revision=2', '?revision=1&householdId=foreign'])('rejects malformed query %s', async (query) => {
    const plan = await generate();
    expect((await request(`/${plan.id}/alternatives${query}`)).status).toBe(422);
  });
});

describe('on-demand explanations and HTTP guard inheritance', () => {
  it('defaults to deterministic IDs without mutation or AI during basic reads', async () => {
    const plan = await generate();
    const before = state();
    await request('/current');
    await request(`/${plan.id}`);
    const response = await request(`/${plan.id}/explanation`, { revision: 1, slotId: SLOT, locale: 'vi' });
    expect(response.status).toBe(200);
    expect(PlanExplanationDtoSchema.parse(await response.json())).toMatchObject({
      planId: plan.id, planRevision: 1, slotId: SLOT, source: 'deterministic',
      fallbackReason: 'disabled', reasonCodes: plan.result.meals[0].reasons,
    });
    expect(transport).not.toHaveBeenCalled();
    expect(state()).toEqual(before);
  });

  it('calls AI only on explicit request and sends no names, quantities, IDs or household data', async () => {
    env.MEAL_PLANNER_AI_ENABLED = 'true';
    const plan = await generate();
    const before = state();
    const response = await request(`/${plan.id}/explanation`, { revision: 1, slotId: SLOT, locale: 'en' });
    expect(response.status).toBe(200);
    expect(PlanExplanationDtoSchema.parse(await response.json())).toMatchObject({ source: 'ai', fallbackReason: null });
    expect(transport).toHaveBeenCalledExactlyOnceWith({ locale: 'en', reasonCodes: plan.result.meals[0].reasons });
    expect(state()).toEqual(before);
  });

  it('falls back through the actual Worker when native provider is unavailable', async () => {
    env.MEAL_PLANNER_AI_ENABLED = 'true';
    const plan = await generate();
    const response = await request(`/${plan.id}/explanation`, { revision: 1, slotId: SLOT, locale: 'en' }, { realWorker: true });
    expect(response.status).toBe(200);
    expect(PlanExplanationDtoSchema.parse(await response.json())).toMatchObject({ source: 'deterministic', fallbackReason: 'provider_unavailable' });
  });

  it('counts generation toward the aggregate budget before a tenth AI request', async () => {
    env.MEAL_PLANNER_AI_ENABLED = 'true';
    const plan = await generate();
    for (let count = 0; count < 9; count += 1) {
      expect((await request(`/${plan.id}/explanation`, { revision: 1, slotId: SLOT, locale: 'vi' })).status).toBe(200);
    }
    const response = await request(`/${plan.id}/explanation`, { revision: 1, slotId: SLOT, locale: 'vi' });
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBeTruthy();
    expect(transport).toHaveBeenCalledTimes(9);
  });

  it('rejects stale revision for both new plan-specific actions', async () => {
    const plan = await generate();
    expect((await request(`/${plan.id}/regenerate`, { revision: 1 })).status).toBe(200);
    for (const response of [await request(`/${plan.id}/alternatives?revision=1`),
      await request(`/${plan.id}/explanation`, { revision: 1, slotId: SLOT, locale: 'vi' })]) {
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: 'PLAN_REVISION_CONFLICT' });
    }
    expect(transport).not.toHaveBeenCalled();
  });

  it('rechecks revision after provider latency and rejects an obsolete explanation', async () => {
    env.MEAL_PLANNER_AI_ENABLED = 'true';
    const plan = await generate();
    transport = async ({ reasonCodes }) => {
      expect((await request(`/${plan.id}/regenerate`, { revision: 1 })).status).toBe(200);
      return JSON.stringify({ reasonCodes });
    };
    const response = await request(`/${plan.id}/explanation`, { revision: 1, slotId: SLOT, locale: 'vi' });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'PLAN_REVISION_CONFLICT' });
  });

  it('rechecks current membership after provider latency', async () => {
    env.MEAL_PLANNER_AI_ENABLED = 'true';
    const plan = await generate();
    transport = async ({ reasonCodes }) => {
      db.seed(`DELETE FROM household_members WHERE user_id = '${scope.userId}'`);
      return JSON.stringify({ reasonCodes });
    };
    expect((await request(`/${plan.id}/explanation`, { revision: 1, slotId: SLOT, locale: 'vi' })).status).toBe(403);
  });

  it('rejects private access, unauthenticated access, disabled flag and owner-fence mismatch', async () => {
    const plan = await generate();
    const payload = { revision: 1, slotId: SLOT, locale: 'vi' };
    for (const cookie of [cookies.member, cookies.foreign]) {
      expect((await request(`/${plan.id}/alternatives?revision=1`, undefined, { cookie })).status).toBe(404);
      expect((await request(`/${plan.id}/explanation`, payload, { cookie })).status).toBe(404);
    }
    for (const [path, body] of [['/current', undefined], [`/${plan.id}/alternatives?revision=1`, undefined],
      [`/${plan.id}/explanation`, payload]] as const) {
      expect((await request(path, body, { cookie: null })).status).toBe(401);
      expect((await request(path, body, { headers: { 'X-Frigo-Expected-Household-Id': 'foreign' } })).status).toBe(403);
      env.MEAL_PLANNER_ENABLED = 'false';
      expect((await request(path, body)).status).toBe(404);
      env.MEAL_PLANNER_ENABLED = 'true';
    }
    expect(transport).not.toHaveBeenCalled();
  });

  it('keeps CSRF and strict explanation intent/selected-slot validation', async () => {
    const plan = await generate();
    const payload = { revision: 1, slotId: SLOT, locale: 'vi' };
    expect((await request(`/${plan.id}/explanation`, payload, { realWorker: true, headers: { Origin: 'https://attacker.example' } })).status).toBe(403);
    for (const body of [{ ...payload, reasonCodes: ['ALLERGEN_SAFE'] }, { ...payload, locale: 'ja' },
      { ...payload, revision: '1' }, { ...payload, slotId: `${DATE}:lunch:0` }]) {
      expect((await request(`/${plan.id}/explanation`, body)).status).toBe(422);
    }
    expect(transport).not.toHaveBeenCalled();
  });
});
