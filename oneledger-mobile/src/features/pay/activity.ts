import { supabase } from "@/api/supabase";

import { stateLabel } from "./messages";
import { formatLocalMsisdn } from "./target";

// Payment activity and templates, read under RLS exactly as the web does
// (web/lib/pay/intents.ts): payment_intents are read-only to members, and
// payment_templates are members' own. Nothing here pays anything; opening an
// activity row shows its review screen, using a template only fills the form.

export type PaymentRow = {
  id: string;
  type: string;
  state: string;
  amountMinor: number;
  currency: string;
  recipient: string;
  createdAt: string;
  verified: boolean;
  manuallyConfirmed: boolean;
};

export const TYPE_LABELS: Record<string, string> = {
  pay_person: "Person",
  pay_merchant: "Merchant",
  pay_bill: "Bill",
  buy_electricity: "Electricity",
  buy_airtime: "Airtime or data",
  government: "Government",
};

type IntentRow = {
  id: string;
  payment_type: string;
  state: string;
  amount_minor: number | string;
  currency: string | null;
  recipient_name: string | null;
  recipient_msisdn_masked: string | null;
  recipient_msisdn_normalized?: string | null;
  merchant_code: string | null;
  created_at: string;
  verified_at?: string | null;
  manually_confirmed_at?: string | null;
};

export function toPaymentRow(r: IntentRow): PaymentRow {
  return {
    id: r.id,
    type: r.payment_type,
    state: r.state,
    amountMinor: Number(r.amount_minor),
    currency: r.currency ?? "RWF",
    recipient: r.recipient_name?.trim() || (r.recipient_msisdn_normalized ? formatLocalMsisdn(r.recipient_msisdn_normalized) : null) || r.recipient_msisdn_masked || (r.merchant_code ? `Merchant ${r.merchant_code}` : TYPE_LABELS[r.payment_type] ?? "Payment"),
    createdAt: r.created_at,
    verified: r.verified_at != null,
    manuallyConfirmed: r.manually_confirmed_at != null,
  };
}

/** The status line under a payment: what it was, and where it stands. */
export function paymentHint(row: PaymentRow): string {
  return `${TYPE_LABELS[row.type] ?? "Payment"} · ${stateLabel(row.state, row)}`;
}

export async function getPaymentActivity(limit = 50): Promise<PaymentRow[]> {
  if (!supabase) throw new Error("not connected");
  const { data, error } = await supabase
    .from("payment_intents")
    .select("id, payment_type, state, amount_minor, currency, recipient_name, recipient_msisdn_masked, recipient_msisdn_normalized, merchant_code, created_at, verified_at, manually_confirmed_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return ((data ?? []) as IntentRow[]).map(toPaymentRow);
}

export type PaymentTemplate = {
  id: string;
  name: string;
  type: string;
  defaultAmountMinor: number | null;
  recipientName: string | null;
  merchantCode: string | null;
  trustedRecipientId: string | null;
};

type TemplateRow = {
  id: string;
  name: string;
  payment_type: string;
  default_amount_minor: number | string | null;
  recipient_snapshot: { name?: string; merchant_code?: string } | null;
  trusted_recipient_id: string | null;
};

export function toTemplate(r: TemplateRow): PaymentTemplate {
  return {
    id: r.id,
    name: r.name,
    type: r.payment_type,
    defaultAmountMinor: r.default_amount_minor == null ? null : Number(r.default_amount_minor),
    recipientName: r.recipient_snapshot?.name ?? null,
    merchantCode: r.recipient_snapshot?.merchant_code ?? null,
    trustedRecipientId: r.trusted_recipient_id,
  };
}

/** The app can fill in a template only for the two kinds it prepares. */
export function templateUsable(t: Pick<PaymentTemplate, "type">): boolean {
  return t.type === "pay_person" || t.type === "pay_merchant";
}

const TEMPLATE_COLUMNS = "id, name, payment_type, default_amount_minor, recipient_snapshot, trusted_recipient_id";

export async function getPaymentTemplates(): Promise<PaymentTemplate[]> {
  if (!supabase) throw new Error("not connected");
  const { data, error } = await supabase.from("payment_templates").select(TEMPLATE_COLUMNS).order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as TemplateRow[]).map(toTemplate);
}

export async function getPaymentTemplate(id: string): Promise<PaymentTemplate | null> {
  if (!supabase) throw new Error("not connected");
  const { data, error } = await supabase.from("payment_templates").select(TEMPLATE_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? toTemplate(data as unknown as TemplateRow) : null;
}
