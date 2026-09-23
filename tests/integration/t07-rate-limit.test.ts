import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { authMiddleware } from '../../src/worker/middleware/auth';
import { createMealPlanningRoutes } from '../../src/worker/routes/meal-planning';
import { MealPlanDtoSchema, type MealPlanDto } from '../../packages/domain/src/meal-planning-api';
import * as planner from '../../packages/recipes/src/weekly-planner';
import { SESSION_COOKIE, sha256Hex } from '../../src/worker/utils/session';
import type { AuthContext, Env } from '../../src/worker/types';
import { SqliteD1 } from '../helpers/sqlite-d1';
import { fixtureRecipeAuthority } from '../helpers/recipe-authority-fixtures';

const origin = 'https://planner.test';
const date = '2030-01-02';
const slotId = `${date}:dinner:0`;
const intent = { startDate: date, horizonDays: 1, defaultServings: 2,
  mode: 'shopping_allowed', slots: [{ date, mealType: 'dinner' }] };
const databases: SqliteD1[] = [];
afterEach(() => { databases.splice(0).forEach((db) => db.close()); vi.restoreAllMocks(); });

async function fixture(primary: boolean) {
  const db = new SqliteD1();
  databases.push(db);
  const owner = crypto.randomUUID();
  const member = crypto.randomUUID();
  const home = crypto.randomUUID();
  db.seed(`INSERT INTO users (id) VALUES ('${owner}'), ('${member}');
    INSERT INTO households (id, name, created_by) VALUES ('${home}', 'Synthetic home', '${owner}');
    INSERT INTO household_members (id, household_id, user_id, role) VALUES
      ('owner', '${home}', '${owner}', 'owner'), ('member', '${home}', '${member}', 'member');
    DELETE FROM recipes;
    INSERT INTO recipes (id, slug, title, cuisine, servings, prep_time_minutes, cook_time_minutes, difficulty)
      VALUES ('meal', 'meal', 'Synthetic meal', 'vietnamese', 2, 0, 10, 'easy');
    INSERT INTO recipe_ingredients (id, recipe_id, ingredient_id, name, required_quantity, unit)
      VALUES ('line', 'meal', 'CHICKEN_BREAST', 'Chicken', 100, 'g');`);
  async function cookie(userId: string) {
    const token = crypto.randomUUID();
    await db.prepare(`INSERT INTO sessions_v2 (id, user_id, household_id, token_hash, expires_at)
      VALUES (?, ?, ?, ?, '2099-01-01T00:00:00Z')`)
      .bind(crypto.randomUUID(), userId, home, await sha256Hex(token)).run();
    return `${SESSION_COOKIE}=${token}`;
  }
  const ownerCookie = await cookie(owner);
  const memberCookie = await cookie(member);
  const counters = new Map<string, string>();
  const cache = { get: async (key: string) => JSON.parse(counters.get(key) ?? 'null'),
    put: async (key: string, value: string) => { counters.set(key, value); } } as unknown as Env['CACHE'];
  const env: Env = { DB: db, APP_URL: origin, ENVIRONMENT: 'development',
    MEAL_PLANNER_ENABLED: 'true', ...(primary ? { CACHE: cache } : {}) };
  const app = new Hono<{ Bindings: Env; Variables: { auth: AuthContext } }>();
  app.use('*', authMiddleware);
  app.route('/api/v1', createMealPlanningRoutes({ now: () => new Date('2030-01-01T00:00:00Z'), recipeAuthority: fixtureRecipeAuthority(db) }));
  const request = (path: string, body?: unknown, session = ownerCookie) => app.request(
    `${origin}/api/v1/meal-planning/plans${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Cookie: session, Origin: origin, 'Content-Type': 'application/json',
        'Idempotency-Key': crypto.randomUUID() },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, env);
  return { request, memberCookie };
}

describe('T07 authenticated planner aggregate compute budget', () => {
  it.each([true, false])('shares a ten-request budget across plan IDs/actions (primary KV: %s)', async (primary) => {
    const { request, memberCookie } = await fixture(primary);
    const compute = vi.spyOn(planner, 'planWeeklyMeals');
    const plans: MealPlanDto[] = [];
    for (let i = 0; i < 2; i++) {
      const response = await request('', intent);
      expect(response.status, await response.clone().text()).toBe(200);
      plans.push(MealPlanDtoSchema.parse(await response.json()));
    }
    for (let i = 0; i < 8; i++) {
      const index = i % plans.length;
      const response = await request(`/${plans[index].id}/regenerate`, { revision: plans[index].revision });
      expect(response.status, await response.clone().text()).toBe(200);
      plans[index] = MealPlanDtoSchema.parse(await response.json());
    }
    expect(compute).toHaveBeenCalledTimes(10);
    const plan = plans[0];
    for (const [path, body] of [
      [`/${plan.id}/regenerate`, { revision: plan.revision }],
      [`/${plan.id}/swap`, { revision: plan.revision, slotId, replacement: { kind: 'recipe', id: 'meal' } }],
      [`/${plans[1].id}/shopping`, { revision: plans[1].revision, currency: 'JPY' }],
      [`/${plan.id}/explanation`, { revision: plan.revision, slotId, locale: 'en' }],
      ['', intent],
    ] as const) {
      const response = await request(path, body);
      expect(response.status, `aggregate budget must reject ${path}`).toBe(429);
      expect(await response.json()).toMatchObject({ code: 'RATE_LIMIT_EXCEEDED' });
      expect(Number(response.headers.get('Retry-After'))).toBeGreaterThan(0);
    }
    expect(compute).toHaveBeenCalledTimes(10);
    expect((await request(`/${plan.id}`)).status).toBe(200);
    expect((await request('/current')).status).toBe(200);
    expect((await request(`/${plan.id}/feedback`, { revision: plan.revision, slotId, type: 'liked' })).status).toBe(200);
    expect((await request('', intent, memberCookie)).status).toBe(200);
    expect(compute).toHaveBeenCalledTimes(11);
  });
});
