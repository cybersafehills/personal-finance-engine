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
  /** null = no verified USSD route for this payment: the app offers no action. */
  instruction: PayInstruction | null;
};

export type PayConfig = { pay: boolean; assistedPay: boolean };
