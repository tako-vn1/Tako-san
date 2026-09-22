import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveRankingPreferences } from '../../packages/db/src/personalization';
import { MealPlanDtoSchema } from '../../packages/domain/src/meal-planning-api';
import { CurrentMealPlanDtoSchema } from '../../packages/domain/src/meal-planning-presentation';
import { authMiddleware } from '../../src/worker/middleware/auth';
import { createMealPlanningRoutes } from '../../src/worker/routes/meal-planning';
import type { AuthContext, Env } from '../../src/worker/types';
import { SESSION_COOKIE, sha256Hex } from '../../src/worker/utils/session';
import { SqliteD1 } from '../helpers/sqlite-d1';
import { fixtureRecipeAuthority } from '../helpers/recipe-authority-fixtures';

vi.mock('../../src/worker/services/email', () => ({
  sendEmail: vi.fn(), buildOtpEmail: vi.fn(),
}));

const ORIGIN = 'https://frigo.example.com';
const DATE = '2030-01-02';
const SLOT = `${DATE}:dinner:0`;
const intent = {
  startDate: DATE,
  horizonDays: 1,
  utcOffsetMinutes: 0,
  defaultServings: 2,
  mode: 'shopping_allowed',
  slots: [{ date: DATE, mealType: 'dinner' }],
};

let fixtureId = 0;
let db: SqliteD1;
let env: Env;
let scope: { householdId: string; userId: string };
let cookies: { owner: string; member: string; foreign: string };
let app: Hono<{ Bindings: Env; Variables: { auth: AuthContext } }>;

beforeEach(async () => {
  fixtureId += 1;
  db = new SqliteD1();
  scope = { householdId: `t07-home-${fixtureId}`, userId: `t07-owner-${fixtureId}` };
  const memberId = `t07-member-${fixtureId}`;
  const foreignId = `t07-foreign-${fixtureId}`;
  const foreignHouseholdId = `t07-foreign-home-${fixtureId}`;
  db.seed(`
    INSERT INTO users (id) VALUES ('${scope.userId}'), ('${memberId}'), ('${foreignId}');
    INSERT INTO households (id, name, created_by) VALUES
      ('${scope.householdId}', 'T07 home', '${scope.userId}'),
      ('${foreignHouseholdId}', 'Foreign home', '${foreignId}');
    INSERT INTO household_members (id, household_id, user_id, role) VALUES
      ('t07-owner-member-${fixtureId}', '${scope.householdId}', '${scope.userId}', 'owner'),
      ('t07-member-member-${fixtureId}', '${scope.householdId}', '${memberId}', 'member'),
      ('t07-foreign-member-${fixtureId}', '${foreignHouseholdId}', '${foreignId}', 'owner');
    DELETE FROM recipes;
    INSERT INTO recipes (id, slug, title, cuisine, servings, prep_time_minutes, cook_time_minutes, difficulty)
      VALUES ('a-small', 'a-small', 'Small chicken meal', 'viet', 2, 0, 10, 'easy'),
        ('z-large', 'z-large', 'Large chicken meal', 'viet', 2, 0, 10, 'easy');
    INSERT INTO recipe_ingredients (id, recipe_id, ingredient_id, name, required_quantity, unit, is_optional)
      VALUES ('t07-small-line', 'a-small', 'CHICKEN_BREAST', 'Chicken', 100, 'g', 0),
        ('t07-large-line', 'z-large', 'CHICKEN_BREAST', 'Chicken', 400, 'g', 0);
    INSERT INTO recipe_steps (id, recipe_id, step_number, instruction)
      VALUES ('t07-small-step', 'a-small', 1, 'Cook thoroughly.');
    INSERT INTO inventory_items (id, household_id, ingredient_id, name, quantity, unit, version)
      VALUES ('t07-stock', '${scope.householdId}', 'CHICKEN_BREAST', 'Chicken', 500, 'g', 1);
  `);
  async function session(userId: string, householdId: string, label: string) {
    const token = `t07-security-${label}-${fixtureId}`;
    await db.prepare(`INSERT INTO sessions_v2 (id, user_id, household_id, token_hash, expires_at)
      VALUES (?, ?, ?, ?, '2099-01-01T00:00:00Z')`)
      .bind(`t07-session-${label}-${fixtureId}`, userId, householdId, await sha256Hex(token)).run();
    return `${SESSION_COOKIE}=${token}`;
  }
  cookies = {
    owner: await session(scope.userId, scope.householdId, 'owner'),
    member: await session(memberId, scope.householdId, 'member'),
    foreign: await session(foreignId, foreignHouseholdId, 'foreign'),
  };
  env = {
    DB: db,
    APP_URL: ORIGIN,
    ENVIRONMENT: 'development',
    MEAL_PLANNER_ENABLED: 'true',
  };
  app = new Hono();
  app.use('*', authMiddleware);
  app.route('/api/v1', createMealPlanningRoutes({ now: () => new Date('2030-01-01T00:00:00.000Z'), recipeAuthority: fixtureRecipeAuthority(db) }));
});

afterEach(() => {
  db.close();
  vi.restoreAllMocks();
});

async function request(
  path = '',
  body?: unknown,
  options: { cookie?: string | null; key?: string; headers?: Record<string, string> } = {},
) {
  const headers = new Headers({
    Origin: ORIGIN,
    'Content-Type': 'application/json',
    'Idempotency-Key': options.key ?? 't07-security-key',
    ...options.headers,
  });
  if (options.cookie !== null) headers.set('Cookie', options.cookie ?? cookies.owner);
  return app.fetch(new Request(`${ORIGIN}/api/v1/meal-planning/plans${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }), env);
}

async function generate(key = 't07-security-key', cookie = cookies.owner) {
  const response = await request('', intent, { key, cookie });
  expect(response.status, await response.clone().text()).toBe(200);
  return MealPlanDtoSchema.parse(await response.json());
}

function planState() {
  return {
    plans: db.query('SELECT id, household_id, creator_user_id, revision FROM generated_meal_plans ORDER BY id'),
    annotations: db.query('SELECT * FROM generated_meal_plan_annotations ORDER BY id'),
    feedback: db.query('SELECT * FROM recipe_feedback_events ORDER BY id'),
  };
}

function revision() {
  return db.query<{ revision: number }>('SELECT revision FROM generated_meal_plans')[0]?.revision;
}

describe('T07 H1 planner tenancy and trust boundary', () => {
  it('keeps every plan action creator-private across household and same-household member sessions', async () => {
    const plan = await generate();
    const actionMatrix: Array<[string, unknown | undefined]> = [
      [`/${plan.id}`, undefined],
      [`/${plan.id}/alternatives?revision=1`, undefined],
      [`/${plan.id}/explanation`, { revision: 1, slotId: SLOT, locale: 'en' }],
      [`/${plan.id}/regenerate`, { revision: 1 }],
      [`/${plan.id}/swap`, { revision: 1, slotId: SLOT, replacement: { kind: 'recipe', id: 'z-large' } }],
      [`/${plan.id}/shopping`, { revision: 1, currency: 'JPY' }],
      [`/${plan.id}/feedback`, { revision: 1, slotId: SLOT, type: 'liked' }],
    ];
    const before = planState();

    for (const cookie of [cookies.member, cookies.foreign]) {
      const current = await request('/current', undefined, { cookie });
      expect(current.status).toBe(200);
      expect(CurrentMealPlanDtoSchema.parse(await current.json())).toEqual({ plan: null });
      for (const [path, body] of actionMatrix) {
        const response = await request(path, body, { cookie });
        expect(response.status, `${path}: ${await response.clone().text()}`).toBe(404);
        expect(response.headers.get('Cache-Control')).toBe('no-store');
      }
    }

    expect(planState()).toEqual(before);
  });

  it('denies every planner boundary after current membership is revoked', async () => {
    const plan = await generate();
    db.seed(`DELETE FROM household_members WHERE household_id = '${scope.householdId}' AND user_id = '${scope.userId}'`);
    const actionMatrix: Array<[string, unknown | undefined]> = [
      ['', intent],
      ['/current', undefined],
      [`/${plan.id}`, undefined],
      [`/${plan.id}/alternatives?revision=1`, undefined],
      [`/${plan.id}/explanation`, { revision: 1, slotId: SLOT, locale: 'en' }],
      [`/${plan.id}/regenerate`, { revision: 1 }],
      [`/${plan.id}/swap`, { revision: 1, slotId: SLOT, replacement: { kind: 'recipe', id: 'z-large' } }],
      [`/${plan.id}/shopping`, { revision: 1, currency: 'JPY' }],
      [`/${plan.id}/feedback`, { revision: 1, slotId: SLOT, type: 'liked' }],
    ];

    for (const [path, body] of actionMatrix) {
      const response = await request(path, body);
      expect(response.status, `${path}: ${await response.clone().text()}`).toBe(403);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
    }
    // The composite creator-membership FK removes private snapshots with access.
    expect(planState()).toEqual({ plans: [], annotations: [], feedback: [] });
  });

  it('requires a cookie session, trusted mutation origin, and exact optional owner fence', async () => {
    const plan = await generate();
    expect((await request(`/${plan.id}/regenerate`, { revision: 1 }, { cookie: null })).status).toBe(401);
    expect((await request(`/${plan.id}/regenerate`, { revision: 1 }, {
      headers: { Origin: 'https://attacker.example' },
    })).status).toBe(403);
    expect((await request(`/${plan.id}`, undefined, {
      headers: { 'X-Frigo-Expected-Household-Id': 'forged-household' },
    })).status).toBe(403);
    expect(revision()).toBe(1);
  });

  it('uses only the authenticated member personal ranking state while retaining household hard policy', async () => {
    await saveRankingPreferences(db, scope, {
      scope: 'user',
      values: { neverRecommendRecipeIds: ['a-small'] },
      updatedAt: '2030-01-01T00:00:00.000Z',
    });
    const ownerPlan = await generate('t07-owner-private-key');
    const memberPlan = await generate('t07-member-private-key', cookies.member);

    expect(ownerPlan.result.meals.map((meal) => meal.source.id)).toEqual(['z-large']);
    expect(memberPlan.result.meals.map((meal) => meal.source.id)).toEqual(['a-small']);
    expect(ownerPlan.id).not.toBe(memberPlan.id);
    expect(db.query('SELECT creator_user_id FROM generated_meal_plans ORDER BY creator_user_id')).toEqual([
      { creator_user_id: `t07-member-${fixtureId}` },
      { creator_user_id: scope.userId },
    ]);
  });

  it('preserves persisted hard restrictions when regenerate omits any client policy and rejects policy injection', async () => {
    await saveRankingPreferences(db, scope, {
      scope: 'household',
      values: { allergens: ['milk'] },
      updatedAt: '2030-01-01T00:00:00.000Z',
    });
    await saveRankingPreferences(db, scope, {
      scope: 'user',
      values: { likedIngredientIds: ['CHICKEN_BREAST'], preferredCuisines: ['viet'] },
      updatedAt: '2030-01-01T00:00:00.000Z',
    });
    db.seed("INSERT INTO recipe_classifications (recipe_id, kind, tag) VALUES ('a-small', 'allergen', 'milk'), ('z-large', 'allergen', 'milk')");
    const plan = await generate();
    expect(plan.result.status).toBe('infeasible');
    expect(plan.result.meals).toEqual([]);

    const regenerated = MealPlanDtoSchema.parse(await (await request(`/${plan.id}/regenerate`, { revision: 1 })).json());
    expect(regenerated).toMatchObject({ revision: 2, result: { status: 'infeasible', meals: [] } });
    for (const hostile of [
      { revision: 2, intent: { ...intent, allergens: [] } },
      { revision: 2, intent: { ...intent, dietaryRestrictions: null } },
      { revision: 2, preferences: { allergens: [] } },
    ]) {
      const response = await request(`/${plan.id}/regenerate`, hostile);
      expect(response.status, await response.clone().text()).toBe(422);
    }
    expect(revision()).toBe(2);
  });
});

const generationClaims: Array<[string, unknown]> = [
  ['householdId', 'other-home'],
  ['creatorUserId', 'other-user'],
  ['userId', 'other-user'],
  ['revision', 999],
  ['planningSnapshot', { inventory: [] }],
  ['rankingContext', { preferences: [] }],
  ['catalog', { recipes: [] }],
  ['inventory', []],
  ['shortages', []],
  ['prices', [{ amountMinor: '0' }]],
  ['substitutions', [{ approved: true }]],
  ['safetyReviews', [{ safe: true }]],
];

describe('T07 H1 hostile planner bodies', () => {
  it.each(generationClaims)('rejects generated-plan client authority claim %s', async (field, value) => {
    const response = await request('', { ...intent, [field]: value });
    expect(response.status, await response.clone().text()).toBe(422);
    expect(planState()).toEqual({ plans: [], annotations: [], feedback: [] });
  });

  it.each([
    ['missing', {}],
    ['null revision', { revision: null }],
    ['null intent', { revision: 1, intent: null }],
    ['empty slots', { revision: 1, intent: { ...intent, slots: [] } }],
    ['nested trusted snapshot', { revision: 1, intent: { ...intent, planningSnapshot: { inventory: [] } } }],
    ['nested ranking context', { revision: 1, intent: { ...intent, rankingContext: { preferences: [] } } }],
    ['outer catalog', { revision: 1, catalog: { recipes: [] } }],
    ['outer price', { revision: 1, prices: [{ amountMinor: '0' }] }],
    ['outer substitution approval', { revision: 1, approvedSubstitutionIds: ['client-approved'] }],
  ])('rejects regenerate %s authority or malformed body', async (_label, body) => {
    const plan = await generate();
    const response = await request(`/${plan.id}/regenerate`, body);
    expect(response.status, await response.clone().text()).toBe(422);
    expect(revision()).toBe(1);
  });

  it.each([
    ['missing replacement', { revision: 1, slotId: SLOT }],
    ['null replacement', { revision: 1, slotId: SLOT, replacement: null }],
    ['empty replacement', { revision: 1, slotId: SLOT, replacement: {} }],
    ['empty recipe ID', { revision: 1, slotId: SLOT, replacement: { kind: 'recipe', id: '' } }],
    ['fabricated recipe version', { revision: 1, slotId: SLOT, replacement: { kind: 'recipe', id: 'z-large', version: 999 } }],
    ['fabricated safety review', { revision: 1, slotId: SLOT, replacement: { kind: 'recipe', id: 'z-large', safety: { reviewed: true } } }],
    ['fabricated substitution approval', { revision: 1, slotId: SLOT, replacement: { kind: 'recipe', id: 'z-large', approvedSubstitutionIds: ['client-approved'] } }],
    ['recipe variant elevation', { revision: 1, slotId: SLOT, replacement: { kind: 'recipe', id: 'z-large', variantId: 'forged-family-variant' } }],
  ])('rejects swap %s without advancing the plan', async (_label, body) => {
    const plan = await generate();
    const response = await request(`/${plan.id}/swap`, body);
    expect(response.status, await response.clone().text()).toBe(422);
    expect(revision()).toBe(1);
  });

  it.each([
    ['top-level prices', { revision: 1, currency: 'JPY', prices: [{ amountMinor: '0' }] }],
    ['top-level shortages', { revision: 1, currency: 'JPY', shortages: [] }],
    ['top-level catalog', { revision: 1, currency: 'JPY', catalog: { trusted: true } }],
    ['top-level inventory', { revision: 1, currency: 'JPY', inventory: [] }],
    ['top-level creator', { revision: 1, currency: 'JPY', creatorUserId: 'other-user' }],
    ['null budget', { revision: 1, currency: 'JPY', budget: null }],
    ['nested price claim', { revision: 1, currency: 'JPY', budget: { mode: 'hard', money: { currency: 'JPY', minorAmount: '100' }, priceAsOf: '2030-01-01T00:00:00Z' } }],
  ])('rejects shopping %s rather than accepting trusted commercial state', async (_label, body) => {
    const plan = await generate();
    const response = await request(`/${plan.id}/shopping`, body);
    expect(response.status, await response.clone().text()).toBe(422);
    expect(revision()).toBe(1);
  });

  it.each([
    ['client target identity', { revision: 1, slotId: SLOT, type: 'liked', target: { kind: 'recipe', id: 'z-large' } }],
    ['client occurred time', { revision: 1, slotId: SLOT, type: 'liked', occurredAt: '2030-01-01T00:00:00Z' }],
    ['client creator', { revision: 1, slotId: SLOT, type: 'liked', creatorUserId: 'other-user' }],
    ['client history', { revision: 1, slotId: SLOT, type: 'liked', history: [] }],
    ['client revision string', { revision: '1', slotId: SLOT, type: 'liked' }],
  ])('rejects feedback %s before writing user state', async (_label, body) => {
    const plan = await generate();
    const response = await request(`/${plan.id}/feedback`, body);
    expect(response.status, await response.clone().text()).toBe(422);
    expect(planState().feedback).toEqual([]);
    expect(planState().annotations).toEqual([]);
  });

  it.each([
    ['reason code injection', { revision: 1, slotId: SLOT, locale: 'en', reasonCodes: ['ALLERGEN_SAFE'] }],
    ['trusted plan injection', { revision: 1, slotId: SLOT, locale: 'en', plan: { result: { safety: 'safe' } } }],
    ['catalog injection', { revision: 1, slotId: SLOT, locale: 'en', catalog: { recipes: [] } }],
    ['malformed locale', { revision: 1, slotId: SLOT, locale: 'ja' }],
  ])('rejects explanation %s without invoking a caller-selected fact set', async (_label, body) => {
    const plan = await generate();
    const response = await request(`/${plan.id}/explanation`, body);
    expect(response.status, await response.clone().text()).toBe(422);
  });

  it('rejects unknown and duplicate alternatives query values rather than treating a client revision as trusted', async () => {
    const plan = await generate();
    for (const path of [
      `/${plan.id}/alternatives?revision=1&catalog=forged`,
      `/${plan.id}/alternatives?revision=1&revision=2`,
      `/${plan.id}/alternatives?revision=01`,
    ]) {
      const response = await request(path);
      expect(response.status, await response.clone().text()).toBe(422);
    }
  });
});
