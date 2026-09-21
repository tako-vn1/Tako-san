import { z } from 'zod';
import type { PaymentInstructions } from '../../shared/payment';
import type { Env } from '../types';
import { applicationOrigin } from '../config/origins';
import type { PaymentRow } from './authority';

const encoder = new TextEncoder();

// payOS signs sorted data, not the surrounding success/code envelope.
export function canonicalPayosData(data: Record<string, unknown>): string {
  return Object.keys(data).sort().map((key) => {
    let value = data[key];
    if (value === null || value === undefined || value === 'null' || value === 'undefined') value = '';
    if (Array.isArray(value)) {
      value = JSON.stringify(value.map((entry: unknown) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
        return Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b)));
      }));
    }
    return `${key}=${String(value)}`;
  }).join('&');
}

async function checksumKey(secret: string) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function signPayosData(data: Record<string, unknown>, secret: string): Promise<string> {
  const signature = await crypto.subtle.sign('HMAC', await checksumKey(secret), encoder.encode(canonicalPayosData(data)));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function verifyPayosData(data: Record<string, unknown>, signature: unknown, secret: string): Promise<boolean> {
  if (typeof signature !== 'string' || !/^[a-f\d]{64}$/i.test(signature)) return false;
  const bytes = Uint8Array.from(signature.match(/.{2}/g)!, (pair) => parseInt(pair, 16));
  return crypto.subtle.verify('HMAC', await checksumKey(secret), bytes, encoder.encode(canonicalPayosData(data)));
}

export function payosConfigured(env: Env): boolean {
  return Boolean(env.PAYOS_CLIENT_ID && env.PAYOS_API_KEY && env.PAYOS_CHECKSUM_KEY && applicationOrigin(env));
}

const linkSchema = z.object({
  bin: z.string().regex(/^\d{6}$/),
  accountNumber: z.string().regex(/^\d{1,32}$/),
  accountName: z.string().min(1).max(200),
  amount: z.number().int().positive().safe(),
  currency: z.literal('VND'),
  orderCode: z.number().int().positive().safe(),
  description: z.string().min(1).max(200),
  status: z.literal('PENDING'),
  expiredAt: z.number().int().positive().optional(),
});

export async function createPayosInstructions(env: Env, intent: PaymentRow): Promise<PaymentInstructions> {
  if (!payosConfigured(env)) throw new Error('Payment provider unavailable');
  const origin = applicationOrigin(env)!;
  const signedFields = {
    amount: intent.amount_vnd,
    cancelUrl: `${origin}/plus`,
    description: intent.description,
    orderCode: Number(intent.order_code),
    returnUrl: `${origin}/plus`,
  };
  const expiredAt = Math.floor(Date.parse(intent.expires_at) / 1000);
  const response = await fetch('https://api-merchant.payos.vn/v2/payment-requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-client-id': env.PAYOS_CLIENT_ID!, 'x-api-key': env.PAYOS_API_KEY! },
    body: JSON.stringify({ ...signedFields, expiredAt, signature: await signPayosData(signedFields, env.PAYOS_CHECKSUM_KEY!) }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error('Payment provider unavailable');
  const result: unknown = await response.json();
  const envelope = z.object({ code: z.literal('00'), data: z.record(z.unknown()), signature: z.string() }).parse(result);
  if (!await verifyPayosData(envelope.data, envelope.signature, env.PAYOS_CHECKSUM_KEY!)) throw new Error('Invalid provider signature');
  const data = linkSchema.parse(envelope.data);
  if (data.amount !== intent.amount_vnd || String(data.orderCode) !== intent.order_code ||
      (data.expiredAt !== undefined && data.expiredAt !== expiredAt)) throw new Error('Invalid provider order');
  const qr = new URL(`https://img.vietqr.io/image/${data.bin}-${data.accountNumber}-compact2.png`);
  qr.searchParams.set('amount', String(intent.amount_vnd));
  qr.searchParams.set('addInfo', data.description);
  qr.searchParams.set('accountName', data.accountName);
  return {
    bankBin: data.bin,
    accountNumber: data.accountNumber,
    accountName: data.accountName,
    transferContent: data.description,
    qrImageUrl: qr.toString(),
  };
}
