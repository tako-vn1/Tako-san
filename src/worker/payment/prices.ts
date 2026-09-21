import type { PlusPlan } from '../../shared/payment';

export const PLUS_PRICES: Readonly<Record<PlusPlan, number>> = Object.freeze({
  monthly: 49000,
  annual: 499000,
});
