export type PlusPlan = 'monthly' | 'annual';
export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'expired' | 'refunded';

export interface PlusPrice {
  plan: PlusPlan;
  amountVnd: number;
  currency: 'VND';
}

export interface PaymentInstructions {
  bankBin: string;
  accountNumber: string;
  accountName: string;
  transferContent: string;
  qrImageUrl: string;
}

export interface PaymentIntent extends PlusPrice {
  id: string;
  orderCode: string;
  description: string;
  expiresAt: string;
  status: PaymentStatus;
}

export interface CreatedPaymentIntent extends PaymentIntent {
  instructions: PaymentInstructions;
}
