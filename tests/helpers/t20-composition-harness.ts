import { vi } from 'vitest';
import { fetchWorker } from './worker-fetch.mjs';
import { resetRecipeAuthorityCacheForTests } from '../../src/worker/services/recipe-authority';
import type { Env } from '../../src/worker/types';
import { SESSION_COOKIE, sha256Hex } from '../../src/worker/utils/session';
import { SqliteD1 } from './sqlite-d1';

/** Real Worker + real SQLite ledger (500-recipe catalog) harness for T20 composition flows. */
export const T20_ORIGIN = 'https://t20.example.test';
export const T20_DATE = '2030-01-02';
export const T20_DATES = Array.from({ length: 7 }, (_, index) =>
  new Date(Date.parse(T20_DATE) + index * 86_400_000).toISOString().slice(0, 10));
export const T20_INTENT = {
  startDate: T20_DATE,
  horizonDays: 7,
  defaultServings: 2,
  mode: 'shopping_allowed',
  slots: T20_DATES.slice(0, 3).map((date) => ({ date, mealType: 'dinner' })),
};
export const T20_STOCK = [
  ['CHICKEN_EGG', 'Trứng gà', 30, 'piece', 'egg'],
  ['TOMATO', 'Cà chua', 20, 'piece', 'vegetable'],
  ['SCALLION', 'Hành lá', 10, 'bunch', 'vegetable'],
  ['COOKING_OIL', 'Dầu ăn', 1000, 'ml', 'spice'],
  ['TOFU', 'Đậu phụ', 10, 'piece', 'vegetable'],
  ['SHRIMP', 'Tôm tươi', 1000, 'g', 'seafood'],
  ['BROCCOLI', 'Bông cải xanh', 5, 'piece', 'vegetable'],
  ['GARLIC', 'Tỏi', 20, 'piece', 'spice'],
  ['FISH_SAUCE', 'Nước mắm', 500, 'ml', 'spice'],
  ['RICE', 'Gạo', 5000, 'g', 'grain'],
  ['PORK_BELLY', 'Thịt ba chỉ', 2000, 'g', 'meat'],
] as const;

export type Mode = 'static' | 'd1';
const MODE_ENV: Record<Mode, Partial<Env>> = {
  static: {},
  d1: { RECIPE_CATALOG_MODE: 'd1', RECIPE_CATALOG_CUTOVER_ENABLED: 'true' },
};

export class T20Harness {
  db = new SqliteD1();
  cookies: Record<string, string> = {};
  users: Record<string, string> = {};
  // Isolate-local rate-limit counters outlive a test, so every seeded user is globally unique.
  private static counter = 0;
  mode: Mode = 'd1';
  extraEnv: Partial<Env> = {};

  async seedHousehold(householdId: string, stock: ReadonlyArray<readonly [string, string, number, string, string]> = T20_STOCK) {
    T20Harness.counter += 1;
    const counter = T20Harness.counter;
    const userId = `t20-user-${householdId}-${counter}`;
    this.db.seed(`INSERT INTO users (id, email, is_guest) VALUES ('${userId}', '${userId}@example.test', 0);
      INSERT INTO households (id, name, created_by) VALUES ('${householdId}', 'T20', '${userId}');
      INSERT INTO household_members (id, household_id, user_id, role) VALUES ('hm-${householdId}', '${householdId}', '${userId}', 'owner');`);
    if (stock.length) {
      this.db.seed(`INSERT INTO inventory_items (id, household_id, ingredient_id, name, quantity, unit, category, storage, freshness, data_source, version) VALUES
        ${stock.map(([id, name, qty, unit, category]) => `('t20-${id.toLowerCase()}-${householdId}', '${householdId}', '${id}', '${name}', ${qty}, '${unit}', '${category}', 'fridge', 'fresh', 'manual', 1)`).join(',\n')};`);
    }
    const token = `t20-session-${householdId}-${counter}`;
    await this.db.prepare(`INSERT INTO sessions_v2 (id, user_id, household_id, token_hash, expires_at) VALUES (?, ?, ?, ?, '2099-01-01T00:00:00Z')`)
      .bind(`sess-${householdId}-${counter}`, userId, householdId, await sha256Hex(token)).run();
    this.cookies[householdId] = `${SESSION_COOKIE}=${token}`;
    this.users[householdId] = userId;
    return userId;
  }

  env(extra: Partial<Env> = {}): Env {
    return {
      DB: this.db, APP_URL: T20_ORIGIN, ENVIRONMENT: 'development', MEAL_PLANNER_ENABLED: 'true',
      MEAL_COMPOSITION_V2_ENABLED: 'true', ...MODE_ENV[this.mode], ...this.extraEnv, ...extra,
    } as unknown as Env;
  }

  async call(householdId: string, method: string, path: string, body?: unknown, extra: Partial<Env> = {},
    headers: Record<string, string> = {}) {
    resetRecipeAuthorityCacheForTests();
    const response = await fetchWorker(new Request(`${T20_ORIGIN}/api/v1${path}`, {
      method,
      headers: { Cookie: this.cookies[householdId], Origin: T20_ORIGIN, 'Content-Type': 'application/json',
        'Idempotency-Key': crypto.randomUUID(), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    }), this.env(extra));
    const text = await response.text();
    let json: any = {};
    try { json = JSON.parse(text); } catch { json = { raw: text }; }
    return { status: response.status, json };
  }

  close() { this.db.close(); }
}

export function quietLogs() {
  const events: Array<Record<string, unknown>> = [];
  vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
    try { const parsed = JSON.parse(String(line)); if (parsed && typeof parsed === 'object') events.push(parsed); } catch { /* not JSON */ }
  });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  return events;
}
