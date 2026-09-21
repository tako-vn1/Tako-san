import type {
  CreatedPaymentIntent,
  PaymentIntent,
  PlusPlan,
  PlusPrice,
} from '../../shared/payment';
import { z } from 'zod';
import { fetchJson } from './http';

type PlansResponse = { plans: PlusPrice[] };
type PaymentResponse<T> = { success: true; payment: T };

const planSchema = z.enum(['monthly', 'annual']);
const amountSchema = z.number().int().positive().safe();
const currencySchema = z.literal('VND');
const timestampSchema = z.string().min(1).refine((value) => Number.isFinite(Date.parse(value)));
const urlSchema = z.string().url().refine((value) => {
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
});
const priceSchema = z.object({
  plan: planSchema,
  amountVnd: amountSchema,
  currency: currencySchema,
});
const statusSchema = z.enum(['pending', 'paid', 'failed', 'expired', 'refunded']);
const paymentSchema = z.object({
  id: z.string().min(1),
  orderCode: z.string().min(1),
  plan: planSchema,
  amountVnd: amountSchema,
  currency: currencySchema,
  description: z.string().min(1),
  expiresAt: timestampSchema,
  status: statusSchema,
});
const instructionsSchema = z.object({
  bankBin: z.string().min(1),
  accountNumber: z.string().min(1),
  accountName: z.string().min(1),
  transferContent: z.string().min(1),
  qrImageUrl: urlSchema,
});
const createdPaymentSchema = paymentSchema.extend({ instructions: instructionsSchema });
const plansResponseSchema = z.object({
  plans: z.array(priceSchema).min(1).refine((plans) => new Set(plans.map((plan) => plan.plan)).size === plans.length),
});
const paymentResponseSchema = <T extends z.ZodTypeAny>(payment: T) => z.object({
  success: z.literal(true),
  payment,
});

function parseBillingResponse<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error(`Invalid ${label} response`);
  return parsed.data;
}

export const billingApi = {
  getPlans: async (): Promise<PlansResponse> => {
    const response = await fetchJson<unknown>('/billing/plans');
    return parseBillingResponse(plansResponseSchema, response, 'billing plans');
  },

  createPaymentIntent: async (
    plan: PlusPlan,
  ): Promise<PaymentResponse<CreatedPaymentIntent>> => {
    const response = await fetchJson<unknown>('/billing/payment-intents', {
      method: 'POST',
      body: JSON.stringify({ plan }),
    });
    return parseBillingResponse<PaymentResponse<CreatedPaymentIntent>>(
      paymentResponseSchema(createdPaymentSchema), response, 'payment intent',
    );
  },

  getPaymentIntent: async (
    id: string,
  ): Promise<PaymentResponse<PaymentIntent>> => {
    const response = await fetchJson<unknown>(`/billing/payment-intents/${encodeURIComponent(id)}`);
    return parseBillingResponse<PaymentResponse<PaymentIntent>>(
      paymentResponseSchema(paymentSchema), response, 'payment status',
    );
  },
};
