import type { PaymentIntent, PaymentStatus, PlusPlan, PlusPrice } from '../../shared/payment';
import { PLUS_PRICES } from './prices';

export const PAYMENT_CURRENCY = 'VND' as const;
export const INTENT_TTL_SECONDS = 30 * 60;

export interface PaymentRow {
  id: string;
  user_id: string;
  plan: PlusPlan;
  amount_vnd: number;
  currency: string;
  order_code: string;
  description: string;
  status: PaymentStatus;
  expires_at: string;
  provider_reference: string | null;
}

export function isValidIssuedIntent(row: PaymentRow): boolean {
  // Issuance fixes the offer; later catalog changes apply only to new orders.
  const expiresAt = typeof row.expires_at === 'string' ? Date.parse(row.expires_at) : NaN;
  return (row.plan === 'monthly' || row.plan === 'annual') &&
    Number.isSafeInteger(row.amount_vnd) && row.amount_vnd > 0 &&
    row.currency === PAYMENT_CURRENCY &&
    typeof row.order_code === 'string' && /^[1-9]\d{0,15}$/.test(row.order_code) &&
    Number.isSafeInteger(Number(row.order_code)) &&
    Number.isFinite(expiresAt) && new Date(expiresAt).toISOString() === row.expires_at &&
    ['pending', 'paid', 'failed', 'expired', 'refunded'].includes(row.status);
}

export function plusPrices(): PlusPrice[] {
  return (['monthly', 'annual'] as const).map((plan) => ({
    plan, amountVnd: PLUS_PRICES[plan], currency: PAYMENT_CURRENCY,
  }));
}

export function paymentView(row: PaymentRow): PaymentIntent {
  return {
    id: row.id,
    orderCode: row.order_code,
    plan: row.plan,
    amountVnd: row.amount_vnd,
    currency: PAYMENT_CURRENCY,
    description: row.description,
    expiresAt: row.expires_at,
    status: row.status === 'pending' && Date.parse(row.expires_at) <= Date.now() ? 'expired' : row.status,
  };
}

export function newOrderCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return String(bytes.reduce((value, byte) => value * 256 + byte, 0) || 1);
}
