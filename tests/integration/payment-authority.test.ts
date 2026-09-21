import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreatedPaymentIntent, PaymentIntent } from '../../src/shared/payment';
import type { Env } from '../../src/worker/types';
import { SESSION_COOKIE, sha256Hex } from '../../src/worker/utils/session';
import { SqliteD1 } from '../helpers/sqlite-d1';
import { fetchWorker } from '../helpers/worker-fetch.mjs';

const ORIGIN = 'http://localhost:8787';
const PAYOS_URL = 'https://api-merchant.payos.vn/v2/payment-requests';
const CLIENT_ID = 'test-payos-client-id';
const API_KEY = 'test-payos-api-key';
const CHECKSUM_KEY = 'test_checksum_key';
// SQLite evaluates datetime('now') using the host clock. Freeze JavaScript at
// that captured clock rather than at a synthetic future time.
const REAL_NOW = Date.now();

type Json = Record<string, unknown>;
type RequestOptions = {
  method?: string;
  body?: Json;
  cookie?: string | null;
  origin?: string | null;
  headers?: Record<string, string>;
};
type ProviderCall = { url: string; init: RequestInit; body: Json };

let db: SqliteD1;
let env: Env;
let userCookie: string;
let otherUserCookie: string;
let guestCookie: string;
let providerCalls: ProviderCall[];
let providerDataOverride: ((request: Json) => Json) | null;
let testNow: Date;
let testNumber = 0;

function canonicalScalarData(data: Record<string, unknown>): string {
  return Object.keys(data)
    .sort()
    .map((key) => `${key}=${data[key] === null || data[key] === undefined ? '' : String(data[key])}`)
    .join('&');
}

function signOfficialData(data: Record<string, unknown>, key = CHECKSUM_KEY): string {
  return createHmac('sha256', key).update(canonicalScalarData(data)).digest('hex');
}

function officialWebhookData(): Record<string, unknown> {
  return {
    accountNumber: '0123456789',
    amount: 20000,
    description: 'thanh toan',
    reference: 'FT-REFERENCE',
    transactionDateTime: '2025-12-12 09:00:00',
    virtualAccountNumber: '',
    counterAccountBankId: '01202001',
    counterAccountBankName: '',
    counterAccountName: 'NGUYEN VAN A',
    counterAccountNumber: '9876543210',
    virtualAccountName: '',
    currency: 'VND',
    orderCode: 0,
    paymentLinkId: 'payment-link-id',
    code: '00',
    desc: 'success',
  };
}

function providerResponseData(request: Json): Json {
  const amount = Number(request.amount);
  const orderCode = Number(request.orderCode);
  return {
    bin: '970422',
    accountNumber: '113366668888',
    accountName: 'QUY VAC XIN PHONG CHONG COVID',
    amount,
    currency: 'VND',
    description: String(request.description),
    orderCode,
    status: 'PENDING',
    expiredAt: Math.floor(Date.now() / 1000) + 30 * 60,
    paymentLinkId: `payment-link-${orderCode}`,
    qrCode: `00020101021238570010A0000007270127000697042201133666688880208${orderCode}`,
    checkoutUrl: `https://pay.payos.vn/web/${orderCode}`,
  };
}

function installProviderMock(): void {
  providerCalls = [];
  providerDataOverride = null;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url !== PAYOS_URL) throw new Error(`Unexpected outbound request: ${url}`);
    const body = JSON.parse(String(init?.body ?? '{}')) as Json;
    providerCalls.push({ url, init: init ?? {}, body });
    const data = providerDataOverride?.(body) ?? providerResponseData(body);
    return new Response(JSON.stringify({
      code: '00',
      desc: 'success',
      data,
      signature: signOfficialData(data),
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
}

async function seedSession(userId: string, isGuest = false): Promise<string> {
  const token = `${userId}-opaque-session-token`;
  await db.prepare('INSERT INTO users (id,email,is_guest) VALUES (?,?,?)')
    .bind(userId, `${userId}@example.com`, isGuest ? 1 : 0).run();
  await db.prepare(
    `INSERT INTO sessions_v2 (id,user_id,household_id,token_hash,expires_at)
     VALUES (?,?,?,?,?)`,
  ).bind(
    `${userId}-session`, userId, `${userId}-household`, await sha256Hex(token), '2099-01-01T00:00:00Z',
  ).run();
  return `${SESSION_COOKIE}=${token}`;
}

async function request(path: string, options: RequestOptions = {}) {
  const headers = new Headers();
  const cookie = options.cookie === undefined ? userCookie : options.cookie;
  const origin = options.origin === undefined ? ORIGIN : options.origin;
  if (cookie) headers.set('Cookie', cookie);
  if (origin) headers.set('Origin', origin);
  if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json');
  }
  for (const [key, value] of Object.entries(options.headers ?? {})) headers.set(key, value);
  const response = await fetchWorker(
    new Request(`${ORIGIN}/api/v1${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    }),
    env,
  );
  const text = await response.text();
  let json: Json = {};
  try { json = text ? JSON.parse(text) as Json : {}; } catch { /* non-JSON error body */ }
  return { response, status: response.status, json };
}

async function createIntent(plan: 'monthly' | 'annual' = 'monthly', cookie = userCookie): Promise<CreatedPaymentIntent> {
  const result = await request('/billing/payment-intents', {
    method: 'POST',
    cookie,
    body: { plan },
  });
  expect(result.status).toBe(201);
  return (result.json.payment as CreatedPaymentIntent);
}

function paymentRow(id: string): Record<string, unknown> {
  return db.query<Record<string, unknown>>('SELECT * FROM payment_intents WHERE id = ?', id)[0];
}

function subscriptionRow(userId = 'user-a'): Record<string, unknown> | undefined {
  return db.query<Record<string, unknown>>('SELECT * FROM subscriptions WHERE user_id = ?', userId)[0];
}

function webhookFor(payment: PaymentIntent, overrides: Json = {}): Json {
  const data: Json = {
    accountNumber: '113366668888',
    amount: payment.amountVnd,
    description: payment.description,
    reference: `reference-${payment.orderCode}`,
    transactionDateTime: '2026-09-21 19:00:00',
    virtualAccountNumber: '',
    counterAccountBankId: '01202001',
    counterAccountBankName: '',
    counterAccountName: 'NGUYEN VAN A',
    counterAccountNumber: '9876543210',
    virtualAccountName: '',
    currency: payment.currency,
    orderCode: Number(payment.orderCode),
    paymentLinkId: `payment-link-${payment.orderCode}`,
    code: '00',
    desc: 'success',
    ...overrides,
  };
  return {
    code: '00',
    desc: 'success',
    success: true,
    data,
    signature: signOfficialData(data),
  };
}

async function postWebhook(body: Json) {
  return request('/billing/payos/webhook', {
    method: 'POST',
    cookie: null,
    origin: null,
    body,
  });
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  // The real app rate-limits payment creation per account. Advance each
  // isolated test into a fresh window without disabling that middleware.
  testNow = new Date(REAL_NOW + testNumber++ * 61 * 1000);
  vi.setSystemTime(testNow);
  db = new SqliteD1();
  userCookie = await seedSession('user-a');
  otherUserCookie = await seedSession('user-b');
  guestCookie = await seedSession('guest-a', true);
  env = {
    DB: db,
    ENVIRONMENT: 'development',
    APP_URL: ORIGIN,
    PAYOS_CLIENT_ID: CLIENT_ID,
    PAYOS_API_KEY: API_KEY,
    PAYOS_CHECKSUM_KEY: CHECKSUM_KEY,
  } as unknown as Env;
  installProviderMock();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  db.close();
});

describe('PayOS webhook signature protocol', () => {
  it('matches the independent official PayOS body signature vector', () => {
    expect(signOfficialData(officialWebhookData())).toBe(
      '302b3becca1672dff99daafae2965f40e48ea3ca39453e4bf37fbcc26807a0e8',
    );
  });
});

describe('server payment authority', () => {
  it('returns only the server price catalog to authenticated non-guests', async () => {
    const result = await request('/billing/plans');
    expect(result.status).toBe(200);
    expect(result.json).toEqual({
      plans: [
        { plan: 'monthly', amountVnd: 49000, currency: 'VND' },
        { plan: 'annual', amountVnd: 499000, currency: 'VND' },
      ],
    });
  });

  it('rejects guests and unauthenticated callers for plans', async () => {
    expect((await request('/billing/plans', { cookie: guestCookie })).status).toBe(401);
    expect((await request('/billing/plans', { cookie: null })).status).toBe(401);
  });

  it.each([
    [{ plan: 'weekly' }],
    [{ plan: '' }],
    [{}],
  ])('rejects malformed plan %o without creating an intent', async (body) => {
    const result = await request('/billing/payment-intents', { method: 'POST', body });
    expect(result.status).toBe(400);
    expect(db.query('SELECT * FROM payment_intents')).toHaveLength(0);
    expect(providerCalls).toHaveLength(0);
  });

  it('ignores legacy client amount fields while using the authoritative monthly amount', async () => {
    const result = await request('/billing/payment-intents', {
      method: 'POST',
      body: { plan: 'monthly', amount: 1, amountVnd: 599000, currency: 'USD' },
    });
    expect(result.status).toBe(201);
    expect(result.json.payment).toMatchObject({ amountVnd: 49000, currency: 'VND', plan: 'monthly', status: 'pending' });
    expect(Number.isSafeInteger(Number((result.json.payment as Json).orderCode))).toBe(true);
    expect(paymentRow(String((result.json.payment as Json).id))).toMatchObject({ amount_vnd: 49000, currency: 'VND', status: 'pending' });
    expect(providerCalls).toHaveLength(1);
    expect(providerCalls[0].body.amount).toBe(49000);
  });

  it('creates annual intent data and signs the exact provider request fields', async () => {
    const payment = await createIntent('annual');
    expect(payment).toMatchObject({ amountVnd: 499000, currency: 'VND', plan: 'annual', status: 'pending' });
    expect(payment.instructions).toMatchObject({
      bankBin: '970422',
      accountNumber: '113366668888',
      accountName: 'QUY VAC XIN PHONG CHONG COVID',
      transferContent: payment.description,
    });
    expect(payment.instructions.qrImageUrl).toContain(`amount=${payment.amountVnd}`);
    expect(payment.instructions.qrImageUrl).toContain(encodeURIComponent(payment.description));

    const call = providerCalls[0];
    expect(call.url).toBe(PAYOS_URL);
    expect(call.init.headers).toMatchObject({ 'x-client-id': CLIENT_ID, 'x-api-key': API_KEY });
    const fields = call.body;
    const signed = ['amount', 'cancelUrl', 'description', 'orderCode', 'returnUrl']
      .sort()
      .map((key) => `${key}=${String(fields[key])}`)
      .join('&');
    expect(fields.signature).toBe(createHmac('sha256', CHECKSUM_KEY).update(signed).digest('hex'));
    expect(fields.amount).toBe(499000);
    expect(fields.orderCode).toBe(Number(payment.orderCode));
    expect(payment.expiresAt).toBe(new Date((Math.floor(testNow.getTime() / 1000) + 30 * 60) * 1000).toISOString());
  });

  it('fails closed before DB/provider work when PayOS configuration is incomplete', async () => {
    const before = db.query('SELECT * FROM payment_intents');
    env.PAYOS_API_KEY = undefined;
    const result = await request('/billing/payment-intents', { method: 'POST', body: { plan: 'monthly' } });
    expect(result.status).toBe(503);
    expect(db.query('SELECT * FROM payment_intents')).toEqual(before);
    expect(providerCalls).toHaveLength(0);
  });

  it('rejects a provider response whose signed amount does not match the local intent', async () => {
    providerDataOverride = (requestBody) => ({ ...providerResponseData(requestBody), amount: 1 });
    const result = await request('/billing/payment-intents', { method: 'POST', body: { plan: 'monthly' } });
    expect(result.status).toBe(502);
    expect(db.query('SELECT * FROM payment_intents')).toHaveLength(1);
    expect(db.query('SELECT status FROM payment_intents')[0]).toEqual({ status: 'pending' });
  });
});

describe('owned payment intent status', () => {
  it('returns DB status without exposing provider payment instructions', async () => {
    const created = await createIntent();
    const result = await request(`/billing/payment-intents/${created.id}`);
    expect(result.status).toBe(200);
    expect(result.json.payment).toMatchObject({
      id: created.id,
      orderCode: created.orderCode,
      amountVnd: 49000,
      currency: 'VND',
      plan: 'monthly',
      status: 'pending',
    });
    expect(result.json.payment).not.toHaveProperty('instructions');
  });

  it('does not disclose another user’s intent', async () => {
    const created = await createIntent('monthly', otherUserCookie);
    const result = await request(`/billing/payment-intents/${created.id}`, { cookie: userCookie });
    expect(result.status).toBe(404);
  });

  it('derives expired status from the server clock without mutating the pending row', async () => {
    const created = await createIntent();
    vi.setSystemTime(new Date(testNow.getTime() + 31 * 60 * 1000));
    const result = await request(`/billing/payment-intents/${created.id}`);
    expect(result.status).toBe(200);
    expect(result.json.payment).toMatchObject({ id: created.id, status: 'expired' });
    expect(paymentRow(created.id)).toMatchObject({ status: 'pending' });
  });

  it('requires CSRF origin protection for cookie-authenticated intent creation', async () => {
    const result = await request('/billing/payment-intents', {
      method: 'POST',
      origin: null,
      body: { plan: 'monthly' },
    });
    expect(result.status).toBe(403);
    expect(providerCalls).toHaveLength(0);
    expect(db.query('SELECT * FROM payment_intents')).toHaveLength(0);
  });
});

describe('verified webhook reconciliation and entitlement grants', () => {
  it('rejects bad signatures before touching the intent', async () => {
    const payment = await createIntent();
    const body = webhookFor(payment);
    body.signature = '00'.repeat(32);
    const result = await postWebhook(body);
    expect(result.status).toBe(401);
    expect(paymentRow(payment.id)).toMatchObject({ status: 'pending', provider_reference: null });
    expect(subscriptionRow()).toBeUndefined();
  });

  it('uses signed data.code rather than the unsigned envelope code', async () => {
    const payment = await createIntent();
    const body = webhookFor(payment);
    body.code = '20';
    const result = await postWebhook(body);
    expect(result.status).toBe(200);
    expect(paymentRow(payment.id)).toMatchObject({ status: 'paid' });
    expect(subscriptionRow()).toMatchObject({ plan: 'plus', status: 'active' });
  });

  it('requires a signed reference and validates amount and currency', async () => {
    const missingReference = await createIntent();
    const missingReferenceBody = webhookFor(missingReference, { reference: '' });
    const missingReferenceResult = await postWebhook(missingReferenceBody);
    expect(missingReferenceResult.status).toBeGreaterThanOrEqual(400);
    expect(missingReferenceResult.status).toBeLessThan(500);

    const wrongAmount = await createIntent();
    expect((await postWebhook(webhookFor(wrongAmount, { amount: 1 }))).status).toBe(409);
    expect(paymentRow(wrongAmount.id)).toMatchObject({ status: 'pending' });

    const wrongCurrency = await createIntent();
    expect((await postWebhook(webhookFor(wrongCurrency, { currency: 'USD' }))).status).toBe(409);
    expect(paymentRow(wrongCurrency.id)).toMatchObject({ status: 'pending' });
  });

  it('does not allow a failed terminal intent to become paid', async () => {
    const payment = await createIntent();
    const failed = webhookFor(payment, { code: '01', desc: 'failed', reference: `failed-${payment.orderCode}` });
    failed.code = '01';
    failed.success = false;
    expect((await postWebhook(failed)).status).toBe(200);
    expect(paymentRow(payment.id)).toMatchObject({ status: 'failed' });

    const paidAfterFailure = await postWebhook(webhookFor(payment, { reference: `paid-${payment.orderCode}` }));
    expect(paidAfterFailure.status).toBe(409);
    expect(subscriptionRow()).toBeUndefined();
  });

  it('ACKs duplicate paid callbacks without extending the same entitlement', async () => {
    const payment = await createIntent();
    const body = webhookFor(payment);
    expect((await postWebhook(body)).status).toBe(200);
    const firstSubscription = subscriptionRow();
    expect(firstSubscription).toBeDefined();

    vi.setSystemTime(new Date(testNow.getTime() + 7 * 24 * 60 * 60 * 1000));
    expect((await postWebhook(body)).status).toBe(200);
    expect(subscriptionRow()).toEqual(firstSubscription);
    expect(paymentRow(payment.id)).toMatchObject({ status: 'paid', provider_reference: `reference-${payment.orderCode}` });
  });

  it('serializes concurrent callbacks for one intent and stacks distinct paid orders', async () => {
    const first = await createIntent('monthly');
    const firstBody = webhookFor(first);
    const concurrent = await Promise.all([postWebhook(firstBody), postWebhook(firstBody)]);
    expect(concurrent.map((result) => result.status).sort()).toEqual([200, 200]);
    const firstExpires = String(subscriptionRow()?.expires_at);

    const second = await createIntent('monthly');
    expect((await postWebhook(webhookFor(second))).status).toBe(200);
    const secondExpires = String(subscriptionRow()?.expires_at);
    expect(Date.parse(secondExpires)).toBeGreaterThan(Date.parse(firstExpires));
    expect(Date.parse(secondExpires) - Date.parse(firstExpires)).toBe(31 * 24 * 60 * 60 * 1000);
  });

  it('ACKs a paid replay after the intent expiry time without mutating entitlement', async () => {
    const payment = await createIntent();
    const body = webhookFor(payment);
    expect((await postWebhook(body)).status).toBe(200);
    const before = subscriptionRow();
    vi.setSystemTime(new Date(testNow.getTime() + 32 * 24 * 60 * 60 * 1000));
    expect((await postWebhook(body)).status).toBe(200);
    expect(subscriptionRow()).toEqual(before);
  });

  it('rejects a first paid callback that crosses the pending intent expiry', async () => {
    const payment = await createIntent();
    vi.setSystemTime(new Date(testNow.getTime() + 31 * 60 * 1000));
    const result = await postWebhook(webhookFor(payment));
    expect(result.status).toBe(409);
    expect(paymentRow(payment.id)).toMatchObject({ status: 'pending', provider_reference: null });
    expect(subscriptionRow()).toBeUndefined();
  });
});

describe('legacy activation retirement', () => {
  it('returns compatibility pending state but never writes a grant', async () => {
    const before = db.query('SELECT * FROM subscriptions WHERE user_id = ?', 'user-a');
    const result = await request('/auth/plus/activate', {
      method: 'POST',
      body: { cycle: 'annual' },
    });
    expect(result.status).toBe(200);
    expect(result.json).toMatchObject({ success: true, granted: false, status: 'pending_verification' });
    expect(db.query('SELECT * FROM subscriptions WHERE user_id = ?', 'user-a')).toEqual(before);
  });

  it('rejects browser-supplied legacy grant codes without writing entitlement', async () => {
    const before = db.query('SELECT * FROM subscriptions WHERE user_id = ?', 'user-a');
    const result = await request('/auth/plus/activate', {
      method: 'POST',
      body: { cycle: 'annual', grantCode: 'legacy-shared-secret' },
    });
    expect(result.status).toBe(410);
    expect(db.query('SELECT * FROM subscriptions WHERE user_id = ?', 'user-a')).toEqual(before);
  });
});

