export type PayInstruction =
  | { ok: true; display: string; telHref: string }
  | { ok: false; error: string };

export type PayIntent = {
  id: string;
  state: string;
  paymentType: string;
  provider: string | null;
  currency: string;
  amountMinor: number;
  recipientName: string | null;
  recipientMasked: string | null;
  merchantCode: string | null;
  expiresAt: string | null;
  /** When it last changed (the hand-off time while it waits). */
  updatedAt: string;
  /** True only when the provider's own message confirmed it; a payment you confirmed yourself is not. */
  verified: boolean;
  /** null = no verified USSD route for this payment: the app offers no action. */
  instruction: PayInstruction | null;
};

export type PayConfig = { pay: boolean; assistedPay: boolean; ussdDirectory: boolean; scanToPay: boolean; trustedRecipients: boolean; paymentRequests: boolean };
