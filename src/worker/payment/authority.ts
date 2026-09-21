import type { PaymentIntent, PaymentStatus, PlusPlan, PlusPrice } from '../../shared/payment';

export const PLUS_PRICES: Readonly<Record<PlusPlan, number>> = Object.freeze({
  monthly: 49000,
  annual: 499000,
});
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

export function hasAuthoritativePrice(row: PaymentRow): boolean {
  return (row.plan === 'monthly' || row.plan === 'annual') &&
    row.amount_vnd === PLUS_PRICES[row.plan] && row.currency === PAYMENT_CURRENCY;
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
