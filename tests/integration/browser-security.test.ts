import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authMiddleware } from '../../src/worker/middleware/auth';
import { authRoutes } from '../../src/worker/routes/auth';
import { inventoryRoutes } from '../../src/worker/routes/inventory';
import { shoppingRoutes } from '../../src/worker/routes/shopping';
import { weekRoutes } from '../../src/worker/routes/week';
import type { AuthContext, Env } from '../../src/worker/types';
import { generateSalt, hashPassword } from '../../src/worker/utils/password';
import { SESSION_COOKIE, sha256Hex } from '../../src/worker/utils/session';
import { SqliteD1 } from '../helpers/sqlite-d1';

vi.mock('../../src/worker/services/email', () => ({
  sendEmail: vi.fn(() => { throw new Error('Verified login must not send email'); }),
  buildOtpEmail: vi.fn(),
}));

const ORIGIN = 'https://browser-security.example.test';
const PASSWORD = 'browser-security-test-password';
const account = (id: string) => ({
  id, email: `${id}@example.test`, displayName: id, householdId: `hh_${id}`,
});
const A = account('browser-user-a');
const B = account('browser-user-b');
const item = (id: string) => ({ id, name: id, quantity: 2, unit: 'piece', category: 'other', storage: 'fridge' });
const SECONDARY_HOUSEHOLD = 'hh_browser-secondary';

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
}

async function loadClient() {
  const { api } = await import('../../src/web/services/api');
  const { useAuthStore: auth } = await import('../../src/web/stores/useAuthStore');
  const { useWeekStore: week } = await import('../../src/web/stores/useWeekStore');
  const { queryClient } = await import('../../src/web/lib/query-client');
  const session = await import('../../src/web/lib/private-session');
  const sync = await import('../../src/web/lib/sync');
  return { api, auth, week, queryClient, session, sync };
}
type Client = Awaited<ReturnType<typeof loadClient>>;

const routes = new Hono<{ Bindings: Env; Variables: { auth: AuthContext } }>();
routes.use('*', authMiddleware);
routes.route('/', authRoutes);
routes.route('/', inventoryRoutes);
routes.route('/', shoppingRoutes);
routes.route('/', weekRoutes);
const app = new Hono<{ Bindings: Env; Variables: { auth: AuthContext } }>();
app.route('/api/v1', routes);

interface BrowserRequest {
  path: string;
  method: string;
  credentials?: RequestCredentials;
  headers: Headers;
  status: number;
}

// Only browser storage/transport is emulated. Routes, cookie authentication,
// client guards, outbox and migrated SQLite are real.
class BrowserTransport {
  cookie = '';
  offline = false;
  issuedCookies: string[] = [];
  requests: BrowserRequest[] = [];
  afterResponse?: (request: BrowserRequest) => void | Promise<void>;

  constructor(private env: Env, private ip: string) {}

  fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input), ORIGIN);
    if (url.origin !== ORIGIN) throw new Error(`Unexpected external request: ${url.origin}`);
    if (this.offline) throw new TypeError('Isolated browser offline');
    const headers = new Headers(init.headers);
    headers.set('Origin', ORIGIN);
    headers.set('CF-Connecting-IP', this.ip);
    if (init.credentials === 'include' && this.cookie) headers.set('Cookie', this.cookie);
    const response = await app.fetch(new Request(url, { ...init, headers }), this.env);
    const setCookie = response.headers.get('Set-Cookie');
    if (init.credentials === 'include' && setCookie) {
      this.issuedCookies.push(setCookie);
      this.cookie = /(?:^|;)\s*Max-Age=0(?:;|$)/i.test(setCookie) ? '' : setCookie.split(';')[0];
    }
    const request = { path: url.pathname, method: init.method ?? 'GET', credentials: init.credentials,
      headers, status: response.status };
    this.requests.push(request);
    await this.afterResponse?.(request);
    const visibleHeaders = new Headers(response.headers);
    visibleHeaders.delete('Set-Cookie');
    return new Response(response.body, { status: response.status, headers: visibleHeaders });
  };
}

let fixture = 0;
let db: SqliteD1;
let env: Env;
let browser: BrowserTransport;
let client: Client;
let inventoryBaseline: ReturnType<typeof storedInventory>;

async function login(user = A) {
  const result = await client.api.login(user.email, PASSWORD);
  expect(result.success).toBe(true);
  expect(result).not.toHaveProperty('token');
  expect(result.user).toMatchObject(user);
  client.auth.getState().setAuthSession(result.user);
  return result.user;
}

async function reload() {
  client.queryClient.clear();
  vi.resetModules();
  vi.stubGlobal('window', new EventTarget());
  client = await loadClient();
}

async function directRequest(path: string, cookie: string) {
  return app.fetch(new Request(`${ORIGIN}/api/v1${path}`, {
    headers: { Cookie: cookie, Origin: ORIGIN },
  }), env);
}

async function createWeekPlan(planId: string) {
  const plan = await client.week.getState().generatePlan({
    planId, householdId: client.auth.getState().householdId, startDate: '2026-09-07',
    householdSize: 2, mealSlotsPreset: 'dinner_only', budgetTargetVnd: 500000,
    priorities: ['use_fridge'], shoppingFrequency: 'once',
  });
  expect(plan.id).toBe(planId);
  expect(db.query('SELECT id, household_id FROM meal_plans WHERE id = ?', planId)).toEqual([
    { id: planId, household_id: client.auth.getState().householdId },
  ]);
  expect(client.week.getState().currentPlan?.id).toBe(planId);
  return plan;
}

async function addSecondaryHousehold() {
  await db.batch([
    db.prepare('INSERT INTO households (id, name, created_by) VALUES (?, ?, ?)')
      .bind(SECONDARY_HOUSEHOLD, 'Secondary', A.id),
    db.prepare('INSERT INTO household_members (id, household_id, user_id, role) VALUES (?, ?, ?, ?)')
      .bind('secondary-member-a', SECONDARY_HOUSEHOLD, A.id, 'owner'),
  ]);
}

async function switchSessionHousehold() {
  // No switch endpoint exists; change only this authorized local fixture session.
  await db.prepare('UPDATE sessions_v2 SET household_id = ? WHERE token_hash = ?')
    .bind(SECONDARY_HOUSEHOLD, await sha256Hex(browser.cookie.split('=')[1])).run();
}

function storedInventory() {
  return db.query<{ id: string; household_id: string }>('SELECT id, household_id FROM inventory_items ORDER BY id');
}

function expectInventory(writes: ReturnType<typeof storedInventory>) {
  // Keep migration-seeded third-tenant rows as an unchanged isolation canary.
  expect(storedInventory()).toEqual([...inventoryBaseline, ...writes].sort((a, b) => a.id.localeCompare(b.id)));
}

beforeEach(async () => {
  fixture += 1;
  vi.resetModules();
  vi.stubGlobal('localStorage', new MemoryStorage());
  vi.stubGlobal('sessionStorage', new MemoryStorage());
  vi.stubGlobal('window', new EventTarget());
  db = new SqliteD1();
  inventoryBaseline = storedInventory();
  env = {
    DB: db, ENVIRONMENT: 'production', APP_URL: ORIGIN,
    JWT_SECRET: 'browser-integration-jwt-secret-not-for-deployment',
    OTP_HASH_SECRET: 'browser-integration-otp-secret-not-for-deployment',
    TURNSTILE_SITE_KEY: 'browser-integration-site-key',
    TURNSTILE_SECRET_KEY: 'browser-integration-secret-key',
    WEEK_SCHEMA_MODE: 'dual',
  };
  for (const user of [A, B]) {
    const salt = generateSalt();
    const hash = await hashPassword(PASSWORD, salt);
    await db.batch([
      db.prepare('INSERT INTO users (id, email) VALUES (?, ?)').bind(user.id, user.email),
      db.prepare('INSERT INTO profiles (id, user_id, display_name) VALUES (?, ?, ?)').bind(`profile-${user.id}`, user.id, user.displayName),
      db.prepare('INSERT INTO auth_accounts (id, user_id, email, password_hash, salt, is_verified) VALUES (?, ?, ?, ?, ?, 1)')
        .bind(`account-${user.id}`, user.id, user.email, hash, salt),
      db.prepare('INSERT INTO households (id, name, created_by) VALUES (?, ?, ?)').bind(user.householdId, user.householdId, user.id),
      db.prepare('INSERT INTO household_members (id, household_id, user_id, role) VALUES (?, ?, ?, ?)')
        .bind(`member-${user.id}`, user.householdId, user.id, 'owner'),
    ]);
  }
  browser = new BrowserTransport(env, `192.0.2.${fixture}`);
  vi.stubGlobal('fetch', vi.fn(browser.fetch));
  client = await loadClient();
});

afterEach(() => {
  client?.queryClient.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  db.close();
});

describe('browser client against real cookie-authenticated SQLite routes', () => {
  it('logs in, validates /me and persists an authenticated API mutation without a script-readable credential', async () => {
    await login();
    expect(browser.issuedCookies).toHaveLength(1);
    expect(browser.issuedCookies[0]).toMatch(new RegExp(`^${SESSION_COOKIE}=[a-f0-9]{64};`));
    for (const flag of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/']) {
      expect(browser.issuedCookies[0]).toContain(flag);
    }
    const token = browser.cookie.split('=')[1];
    expect(db.query('SELECT token_hash FROM sessions_v2')).toEqual([{ token_hash: await sha256Hex(token) }]);
    const me = await client.api.getMe({ requireServer: true });
    expect(me.user).toMatchObject({ id: A.id, household: { id: A.householdId } });
    const created = await client.api.addInventoryItem(item('online-a'));
    expect(created).toMatchObject({ id: 'online-a', householdId: A.householdId });
    expectInventory([{ id: 'online-a', household_id: A.householdId }]);
    expect((await client.api.getInventory()).map((entry: { id: string }) => entry.id)).toEqual(['online-a']);
    expect(browser.requests.map(({ path, method, status }) => [path, method, status])).toEqual([
      ['/api/v1/auth/login', 'POST', 200], ['/api/v1/me', 'GET', 200],
      ['/api/v1/inventory', 'POST', 201], ['/api/v1/inventory', 'GET', 200], ['/api/v1/inventory', 'GET', 200],
    ]);
    for (const request of browser.requests) {
      expect(request.credentials).toBe('include');
      expect(request.headers.has('Authorization')).toBe(false);
      if (!request.path.includes('/auth/')) {
        expect(request.headers.get('X-Frigo-Expected-User-Id')).toBe(A.id);
        expect(request.headers.get('X-Frigo-Expected-Household-Id')).toBe(A.householdId);
      }
    }
    expect(localStorage.getItem('frigo_token')).toBeNull();
    expect(sessionStorage.getItem('frigo_guest_token')).toBeNull();
    for (const storage of [localStorage, sessionStorage]) {
      for (let index = 0; index < storage.length; index++) {
        expect(storage.getItem(storage.key(index)!)).not.toContain(token);
      }
    }
  });

  it('confirms logout on the server, rejects the old cookie and stays anonymous after reload', async () => {
    await login();
    await client.api.addInventoryItem(item('logout-private-a'));
    const cookie = browser.cookie;
    const cacheKey = client.session.privateCacheKey('inventory');
    expect(localStorage.getItem(cacheKey)).toContain('logout-private-a');
    await expect(client.auth.getState().logout()).resolves.toBe(true);
    expect(browser.cookie).toBe('');
    expect(browser.issuedCookies.at(-1)).toContain('Max-Age=0');
    expect(db.query('SELECT revoked_at FROM sessions_v2')[0].revoked_at).not.toBeNull();
    expect((await directRequest('/me', cookie)).status).toBe(401);
    expect((await directRequest('/inventory', cookie)).status).toBe(401);
    expect(localStorage.getItem(cacheKey)).toBeNull();
    await reload();
    expect(client.auth.getState()).toMatchObject({ userId: '', householdId: '', isGuest: true, logoutStatus: 'idle' });
    const requestCount = browser.requests.length;
    await expect(client.api.getMe({ requireServer: true })).rejects.toMatchObject({ kind: 'auth' });
    await expect(client.api.getInventory()).rejects.toMatchObject({ kind: 'auth' });
    expect(browser.requests).toHaveLength(requestCount);
    expect((await directRequest('/me', browser.cookie)).status).toBe(401);
  });

  it('blocks a still-valid cookie across reload after offline logout, then revokes it on retry', async () => {
    await login();
    await client.api.addInventoryItem(item('failed-logout-a'));
    const cookie = browser.cookie;
    const cacheKey = client.session.privateCacheKey('inventory');
    browser.offline = true;
    await client.api.addInventoryItem(item('failed-logout-pending-a'));
    expect(client.sync.getPendingOps()).toHaveLength(1);
    await expect(client.auth.getState().logout()).resolves.toBe(false);
    expect(browser.cookie).toBe(cookie);
    expect(db.query('SELECT revoked_at FROM sessions_v2')).toEqual([{ revoked_at: null }]);
    expect(localStorage.getItem(cacheKey)).toBeNull();
    expect(client.sync.getPendingOps()).toEqual([]);

    await reload();
    expect(client.auth.getState()).toMatchObject({ userId: '', householdId: '', logoutStatus: 'error' });
    expect(client.session.privateSessionBlocked()).toBe(true);
    browser.offline = false;
    const requestCount = browser.requests.length;
    await expect(client.api.getMe({ requireServer: true })).rejects.toMatchObject({ kind: 'auth' });
    await expect(client.api.getInventory()).rejects.toMatchObject({ kind: 'auth' });
    await expect(client.api.retryPendingWrites()).resolves.toEqual({ attempted: 0, remaining: 0 });
    expect(() => client.auth.getState().setAuthSession(B)).toThrow(client.session.LOGOUT_WARNING);
    expect(browser.requests).toHaveLength(requestCount);
    expect((await directRequest('/me', cookie)).status).toBe(200);

    await expect(client.auth.getState().logout()).resolves.toBe(true);
    expect(browser.requests.at(-1)).toMatchObject({ path: '/api/v1/auth/logout', status: 200 });
    expect(browser.requests.at(-1)?.headers.get('Cookie')).toBe(cookie);
    expect((await directRequest('/me', cookie)).status).toBe(401);
    expect(browser.cookie).toBe('');
    await login(B);
    await expect(client.api.getInventory()).resolves.toEqual([]);
    expectInventory([{ id: 'failed-logout-a', household_id: A.householdId }]);
  });

  it('clears hydrated private state on an authoritative expired-session response instead of serving stale offline data', async () => {
    await login();
    await client.api.addInventoryItem(item('expired-private-a'));
    const cacheKey = client.session.privateCacheKey('inventory');
    await reload();
    expect(client.auth.getState().userId).toBe(A.id);
    expect(localStorage.getItem(cacheKey)).toContain('expired-private-a');
    db.seed("UPDATE sessions_v2 SET expires_at = datetime('now', '-1 minute')");
    await expect(client.api.getInventory()).rejects.toMatchObject({ kind: 'auth', status: 401 });
    expect(browser.requests.at(-1)?.status).toBe(401);
    expect(client.auth.getState()).toMatchObject({ userId: '', householdId: '' });
    expect(localStorage.getItem(cacheKey)).toBeNull();
    browser.offline = true;
    await expect(client.api.getInventory()).rejects.toMatchObject({ kind: 'auth' });
    expect(client.queryClient.getQueryCache().getAll()).toHaveLength(0);
  });

  it('isolates real inventory, shopping and Week caches through A → logout → B → reload → offline', async () => {
    await login();
    await client.api.addInventoryItem(item('account-a-food'));
    await client.api.addShoppingItem({ id: 'account-a-shopping', name: 'A private shopping', quantity: 1, unit: 'piece' });
    const planA = await createWeekPlan('plan_browser_account_a');
    client.queryClient.setQueryData(['inventory', A.id, A.householdId], await client.api.getInventory());
    const oldKeys = ['inventory', 'shopping_list', 'active_meal_plan'].map((key) => client.session.privateCacheKey(key));
    expect(localStorage.getItem(oldKeys[0])).toContain('account-a-food');
    expect(localStorage.getItem(oldKeys[1])).toContain('account-a-shopping');
    expect(localStorage.getItem(oldKeys[2])).toContain(planA.id);
    await expect(client.auth.getState().logout()).resolves.toBe(true);
    await login(B);
    expect(client.week.getState().currentPlan).toBeNull();
    expect(client.queryClient.getQueryCache().getAll()).toHaveLength(0);
    for (const key of oldKeys) expect(localStorage.getItem(key)).toBeNull();
    await expect(client.api.getInventory()).resolves.toEqual([]);
    await expect(client.api.getShoppingList()).resolves.toEqual([]);
    await expect(client.week.getState().loadCurrentPlan()).resolves.toBeNull();
    await expect(client.api.getWeekPlan(planA.id)).rejects.toMatchObject({ status: 404 });
    await client.api.addInventoryItem(item('account-b-food'));
    await client.api.addShoppingItem({ id: 'account-b-shopping', name: 'B shopping', quantity: 1, unit: 'piece' });
    const planB = await createWeekPlan('plan_browser_account_b');
    await reload();
    expect((await client.api.getMe({ requireServer: true })).user.id).toBe(B.id);
    browser.offline = true;
    expect((await client.api.getInventory()).map((entry: { id: string }) => entry.id)).toEqual(['account-b-food']);
    expect((await client.api.getShoppingList()).map((entry: { id: string }) => entry.id)).toEqual(['account-b-shopping']);
    expect(await client.week.getState().loadCurrentPlan()).toEqual(planB);
    expect(client.week.getState().currentPlan).toEqual(planB);
    await expect(client.api.getWeekPlan(planA.id)).resolves.toBeNull();
    expectInventory([
      { id: 'account-a-food', household_id: A.householdId },
      { id: 'account-b-food', household_id: B.householdId },
    ]);
  });

  it('projects the cookie session’s active household when the user belongs to multiple households', async () => {
    await login();
    await addSecondaryHousehold();
    expect(db.query('SELECT household_id FROM sessions_v2 WHERE token_hash = ?',
      await sha256Hex(browser.cookie.split('=')[1]))).toEqual([{ household_id: A.householdId }]);
    const response = await directRequest('/me', browser.cookie);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ user: {
      id: A.id, household: { id: A.householdId, name: A.householdId },
    } });
    await expect(client.api.getMe({ requireServer: true })).resolves.toMatchObject({ user: {
      id: A.id, household: { id: A.householdId },
    } });
    expect(client.auth.getState()).toMatchObject({ userId: A.id, householdId: A.householdId });
    expect(client.session.privateSessionBlocked()).toBe(false);
  });

  it('clears household A projections and reads only household B after an authorized session scope change', async () => {
    await login();
    await client.api.addInventoryItem(item('household-a-food'));
    await client.api.addShoppingItem({ id: 'household-a-shopping', name: 'Household A shopping', quantity: 1, unit: 'piece' });
    const planA = await createWeekPlan('plan_browser_household_a');
    const oldKeys = ['inventory', 'shopping_list', 'active_meal_plan'].map((key) => client.session.privateCacheKey(key));
    client.queryClient.setQueryData(['inventory'], await client.api.getInventory());
    await addSecondaryHousehold();
    await switchSessionHousehold();
    client.auth.getState().setAuthSession({ ...A, householdId: SECONDARY_HOUSEHOLD });
    expect(client.week.getState().currentPlan).toBeNull();
    expect((await client.api.getMe({ requireServer: true })).user).toMatchObject({
      id: A.id, household: { id: SECONDARY_HOUSEHOLD, name: 'Secondary' },
    });
    for (const key of oldKeys) expect(localStorage.getItem(key)).toBeNull();
    expect(client.queryClient.getQueryCache().getAll()).toHaveLength(0);
    await expect(client.api.getInventory()).resolves.toEqual([]);
    await expect(client.api.getShoppingList()).resolves.toEqual([]);
    await expect(client.week.getState().loadCurrentPlan()).resolves.toBeNull();
    await expect(client.api.getWeekPlan(planA.id)).rejects.toMatchObject({ status: 404 });
    await client.api.addInventoryItem(item('household-b-food'));
    const planB = await createWeekPlan('plan_browser_household_b');
    await reload();
    browser.offline = true;
    expect((await client.api.getInventory()).map((entry: { id: string }) => entry.id)).toEqual(['household-b-food']);
    await expect(client.api.getShoppingList()).resolves.toEqual([]);
    expect(await client.week.getState().loadCurrentPlan()).toEqual(planB);
    expect(client.week.getState().currentPlan).toEqual(planB);
    await expect(client.api.getWeekPlan(planA.id)).resolves.toBeNull();
    expectInventory([
      { id: 'household-a-food', household_id: A.householdId },
      { id: 'household-b-food', household_id: SECONDARY_HOUSEHOLD },
    ]);
  });

  it('reconnects through the real online event and commits only B’s offline operation after A logs out', async () => {
    await login();
    browser.offline = true;
    await client.api.addInventoryItem(item('offline-a-food'));
    expect(client.sync.getPendingOps()).toEqual([expect.objectContaining({ userId: A.id, householdId: A.householdId })]);
    expectInventory([]);
    browser.offline = false;
    await expect(client.auth.getState().logout()).resolves.toBe(true);
    await login(B);
    expect(client.sync.getPendingOps()).toEqual([]);
    browser.offline = true;
    await client.api.addInventoryItem(item('offline-b-food'));
    expect(client.sync.getPendingOps()).toEqual([expect.objectContaining({ userId: B.id, householdId: B.householdId })]);
    const reconnectStart = browser.requests.length;
    const retry = vi.fn(() => client.api.retryPendingWrites());
    client.sync.initSync(retry);
    browser.offline = false;
    window.dispatchEvent(new Event('online'));
    expect(retry).toHaveBeenCalledTimes(1);
    await expect(retry.mock.results[0].value).resolves.toEqual({ attempted: 1, remaining: 0 });
    expectInventory([{ id: 'offline-b-food', household_id: B.householdId }]);
    expect(client.sync.getPendingOps()).toEqual([]);
    const replayed = browser.requests.slice(reconnectStart);
    expect(replayed[0]).toMatchObject({ path: '/api/v1/me', method: 'GET', status: 200 });
    expect(replayed.filter(({ method }) => method === 'POST')).toHaveLength(1);
    expect(replayed.find(({ method }) => method === 'POST')?.headers.get('X-Frigo-Expected-User-Id')).toBe(B.id);
    expect((await client.api.getInventory()).map((entry: { id: string }) => entry.id)).toEqual(['offline-b-food']);
  });

  it.each([
    ['account', 'before identity validation'],
    ['account', 'after identity validation'],
    ['household', 'before identity validation'],
    ['household', 'after identity validation'],
  ] as const)(
    'does not replay A’s outbox in another %s when the server session changes %s', async (scope, moment) => {
      let cookieB = '';
      if (scope === 'account') {
        await login(B);
        cookieB = browser.cookie;
      } else await addSecondaryHousehold();
      await login(A);
      const changeServerScope = async () => {
        if (scope === 'account') browser.cookie = cookieB;
        else await switchSessionHousehold();
      };
      browser.offline = true;
      await client.api.addInventoryItem(item('cookie-race-a-food'));
      const pending = client.sync.getPendingOps();
      expect(pending).toHaveLength(1);
      browser.offline = false;
      const replayStart = browser.requests.length;
      if (moment === 'before identity validation') await changeServerScope();
      else browser.afterResponse = async ({ path }) => {
        if (path === '/api/v1/me') await changeServerScope();
      };
      await expect(client.api.retryPendingWrites()).resolves.toEqual({ attempted: 0, remaining: 1 });
      expect(client.sync.getPendingOps()).toEqual(pending);
      expectInventory([]);
      const requests = browser.requests.slice(replayStart);
      expect(requests.map(({ path, status }) => [path, status])).toEqual(moment === 'before identity validation'
        ? [['/api/v1/me', 403]]
        : [['/api/v1/me', 200], ['/api/v1/inventory', 403]]);
      expect(requests.at(-1)?.headers.get('X-Frigo-Expected-User-Id')).toBe(A.id);
      expect(requests.at(-1)?.headers.get('X-Frigo-Expected-Household-Id')).toBe(A.householdId);
      expect(requests.at(-1)?.headers.get('Cookie')).toBe(browser.cookie);
      expect(client.auth.getState()).toMatchObject({ userId: A.id, householdId: A.householdId });
      expect(db.query('SELECT user_id, household_id FROM sessions_v2 WHERE token_hash = ?',
        await sha256Hex(browser.cookie.split('=')[1]))).toEqual([{
        user_id: scope === 'account' ? B.id : A.id,
        household_id: scope === 'account' ? B.householdId : SECONDARY_HOUSEHOLD,
      }]);
    },
  );
});
