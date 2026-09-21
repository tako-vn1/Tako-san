import { Hono } from 'hono';
import { z } from 'zod';
import type { Env, AuthContext } from '../types';
import { rateLimiter } from '../middleware/rate-limit';
import {
  hasAuthoritativePrice, INTENT_TTL_SECONDS, newOrderCode, PAYMENT_CURRENCY,
  paymentView, PLUS_PRICES, plusPrices, type PaymentRow,
} from '../payment/authority';
import { createPayosInstructions, payosConfigured, verifyPayosData } from '../payment/payos';

export const billingRoutes = new Hono<{ Bindings: Env; Variables: { auth: AuthContext } }>();
const planRequest = z.object({ plan: z.enum(['monthly', 'annual']) });
const webhookData = z.object({
  orderCode: z.number().int().positive().safe(),
  amount: z.number().int().positive().safe(),
  currency: z.string(),
  reference: z.string().min(1).max(200),
  code: z.string().min(1),
});

billingRoutes.use('/billing/*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  if (c.req.path.endsWith('/billing/payos/webhook')) return next();
  const auth = c.get('auth');
  if (!auth?.userId || auth.isGuest) return c.json({ error: 'Đăng nhập bắt buộc', code: 'UNAUTHORIZED' }, 401);
  if (!c.env.DB) return c.json({ error: 'Dịch vụ thanh toán chưa sẵn sàng', code: 'DATABASE_UNAVAILABLE' }, 503);
  return next();
});

billingRoutes.get('/billing/plans', (c) => c.json({ plans: plusPrices() }));

billingRoutes.post('/billing/payment-intents', rateLimiter({
  maxRequests: 10, windowSeconds: 60, prefix: 'rl_payment_create', enforcement: 'fail-closed',
}), async (c) => {
  // Extra legacy fields are ignored; none can override server monetary values.
  const parsed = planRequest.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Gói Plus không hợp lệ', code: 'INVALID_PLAN' }, 400);
  if (!payosConfigured(c.env)) return c.json({ error: 'Thanh toán tạm thời chưa khả dụng', code: 'PAYMENT_UNAVAILABLE' }, 503);
  const { plan } = parsed.data;
  const orderCode = newOrderCode();
  const intent: PaymentRow = {
    id: `pay_${crypto.randomUUID()}`, user_id: c.get('auth').userId,
    plan, amount_vnd: PLUS_PRICES[plan], currency: PAYMENT_CURRENCY,
    order_code: orderCode, description: `TP${orderCode.slice(-7)}`,
    expires_at: new Date((Math.floor(Date.now() / 1000) + INTENT_TTL_SECONDS) * 1000).toISOString(),
    status: 'pending', provider_reference: null,
  };
  await c.env.DB.prepare(`INSERT INTO payment_intents
    (id,user_id,plan,amount_vnd,currency,order_code,description,expires_at) VALUES (?,?,?,?,?,?,?,?)`)
    .bind(intent.id, intent.user_id, plan, intent.amount_vnd, intent.currency, orderCode, intent.description, intent.expires_at).run();
  try {
    const instructions = await createPayosInstructions(c.env, intent);
    intent.description = instructions.transferContent;
    await c.env.DB.prepare('UPDATE payment_intents SET description = ? WHERE id = ?')
      .bind(intent.description, intent.id).run();
    return c.json({ success: true, payment: { ...paymentView(intent), instructions } }, 201);
  } catch {
    // A timed-out provider may have created the order. Never fabricate instructions or a grant.
    return c.json({ error: 'Chưa tạo được hướng dẫn thanh toán. Vui lòng thử lại.', code: 'PAYMENT_PROVIDER_UNAVAILABLE' }, 502);
  }
});

billingRoutes.get('/billing/payment-intents/:id', async (c) => {
  const intent = await c.env.DB.prepare('SELECT * FROM payment_intents WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), c.get('auth').userId).first<PaymentRow>();
  if (!intent) return c.json({ error: 'Không tìm thấy thanh toán', code: 'PAYMENT_NOT_FOUND' }, 404);
  if (!hasAuthoritativePrice(intent)) return c.json({ error: 'Thanh toán không hợp lệ', code: 'PAYMENT_INVALID' }, 409);
  return c.json({ success: true, payment: paymentView(intent) });
});

billingRoutes.post('/billing/payos/webhook', async (c) => {
  const receivedAt = new Date().toISOString();
  if (!c.env.DB || !c.env.PAYOS_CHECKSUM_KEY) return c.json({ error: 'Webhook chưa cấu hình' }, 503);
  const envelope = z.object({ data: z.record(z.unknown()), signature: z.string().optional() })
    .safeParse(await c.req.json().catch(() => null));
  if (!envelope.success) return c.json({ error: 'Invalid webhook' }, 400);
  const { data } = envelope.data;
  const signature = c.req.header('x-payos-signature') || envelope.data.signature;
  if (!await verifyPayosData(data, signature, c.env.PAYOS_CHECKSUM_KEY)) return c.json({ error: 'Invalid signature' }, 401);
  const parsed = webhookData.safeParse(data);
  if (!parsed.success) return c.json({ error: 'Invalid payment data' }, 400);
  const payment = parsed.data;
  const intent = await c.env.DB.prepare('SELECT * FROM payment_intents WHERE order_code = ?')
    .bind(String(payment.orderCode)).first<PaymentRow>();
  if (!intent || !hasAuthoritativePrice(intent) || payment.amount !== intent.amount_vnd || payment.currency !== intent.currency) {
    return c.json({ error: 'Payment reconciliation failed' }, 409);
  }
  const status = payment.code === '00' ? 'paid' : 'failed';
  if (intent.status === status && intent.provider_reference === payment.reference) return c.json({ success: true });
  if (intent.status !== 'pending' || !Number.isFinite(Date.parse(intent.expires_at)) || Date.parse(intent.expires_at) <= Date.parse(receivedAt)) {
    return c.json({ error: 'Payment is no longer pending' }, 409);
  }
  const days = intent.plan === 'annual' ? 366 : 31;
  try {
    // D1 batch is transactional: only the still-pending order may grant, then it is consumed.
    const results = await c.env.DB.batch([
      ...(status === 'paid' ? [c.env.DB.prepare(`INSERT INTO subscriptions (id, user_id, plan, status, expires_at)
        SELECT ?, user_id, 'plus', 'active', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?)
        FROM payment_intents WHERE id = ? AND status = 'pending' AND datetime(expires_at) > datetime(?)
        ON CONFLICT(user_id) DO UPDATE SET plan = 'plus', status = 'active',
          expires_at = strftime('%Y-%m-%dT%H:%M:%fZ',
            CASE WHEN subscriptions.plan = 'plus' AND subscriptions.status = 'active'
              AND datetime(subscriptions.expires_at) > datetime('now')
              THEN subscriptions.expires_at ELSE datetime('now') END, ?),
          updated_at = datetime('now')`)
        .bind(`sub_${intent.user_id}`, `+${days} days`, intent.id, receivedAt, `+${days} days`)] : []),
      c.env.DB.prepare(`UPDATE payment_intents SET status = ?, provider_reference = ?, updated_at = datetime('now')
        WHERE id = ? AND status = 'pending' AND datetime(expires_at) > datetime(?)`)
        .bind(status, payment.reference, intent.id, receivedAt),
    ]);
    if (results.at(-1)?.meta?.changes === 0) {
      const current = await c.env.DB.prepare('SELECT * FROM payment_intents WHERE id = ?').bind(intent.id).first<PaymentRow>();
      if (current?.status !== status || current.provider_reference !== payment.reference) return c.json({ error: 'Payment transition rejected' }, 409);
    }
    return c.json({ success: true });
  } catch {
    // A duplicate provider reference rolls back the subscription and intent together.
    return c.json({ error: 'Payment reconciliation failed' }, 409);
  }
});
