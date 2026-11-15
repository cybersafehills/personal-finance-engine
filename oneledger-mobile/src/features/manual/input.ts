import { kigaliDayBoundsUtc } from "@/lib/kigali-time";
import { toMinorUnits, type SupportedCurrency } from "@/lib/money";

// Building a manually entered transaction. These are the rules of the web's
// createManualTransaction (web/app/transactions/actions.ts): a manual entry
// is always settled and successful, direction is in or out, the currency comes
// from the chosen account, and the principal/fee effects are exactly what the
// database's accounting check constraint expects. Kept pure so it is tested
// without a database; the insert itself runs under the user's session (RLS).

export type ManualTransactionType =
  | "send_money"
  | "merchant_payment"
  | "money_received"
  | "airtime"
  | "cash_withdrawal"
  | "cash_deposit"
  | "bill_payment"
  | "bank_transfer"
  | "other";

export const MANUAL_TYPES: { key: ManualTransactionType; label: string; direction: "in" | "out" }[] = [
  { key: "merchant_payment", label: "Paid a merchant", direction: "out" },
  { key: "send_money", label: "Sent money", direction: "out" },
  { key: "money_received", label: "Received money", direction: "in" },
  { key: "airtime", label: "Airtime", direction: "out" },
  { key: "bill_payment", label: "Bill payment", direction: "out" },
  { key: "cash_withdrawal", label: "Cash withdrawal", direction: "out" },
  { key: "cash_deposit", label: "Cash deposit", direction: "in" },
  { key: "bank_transfer", label: "Bank transfer", direction: "out" },
  { key: "other", label: "Other", direction: "out" },
];

export function defaultDirection(type: ManualTransactionType): "in" | "out" {
  return MANUAL_TYPES.find((t) => t.key === type)?.direction ?? "out";
}

export type ManualAccount = {
  id: string;
  name: string;
  workspaceId: string;
  currency: SupportedCurrency;
};

export type When =
  | { kind: "now" }
  | { kind: "yesterday" }
  /** `dateKey` is a Kigali calendar day (YYYY-MM-DD); `timeText` is 24-hour HH:MM. */
  | { kind: "custom"; dateKey: string; timeText: string };

export type ManualForm = {
  transactionType: ManualTransactionType;
  direction: "in" | "out";
  amountText: string;
  feeText: string;
  when: When;
  counterpartyName: string;
  notes: string;
};

/** The `transactions` row to insert. */
export type ManualTransactionRow = {
  momo_message_id: null;
  account_id: string;
  workspace_id: string;
  source: "manual";
  transaction_type: ManualTransactionType;
  direction: "in" | "out";
  status: "success";
  currency: SupportedCurrency;
  amount_rwf: number;
  fee_rwf: number;
  principal_effect_rwf: number;
  fee_effect_rwf: number;
  settlement_state: "settled";
  affects_balance: true;
  effect_reason: "manual_entry";
  counterparty_name: string | null;
  occurred_at: string;
  category: null;
  category_source: null;
  notes: string | null;
  parser_version: "manual-entry-v1";
};

export type BuildResult =
  | { ok: true; row: ManualTransactionRow }
  | { ok: false; error: string };

/** Far above any real amount; keeps every figure an exact JS integer. */
const MAX_MINOR = 1_000_000_000_000;
const FUTURE_SLACK_MS = 5 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
const MAX_COUNTERPARTY = 120;
const MAX_NOTES = 500;

/** The instant for a custom Kigali date and time, or an error message. */
export function resolveWhen(when: When, nowMs: number): { ok: true; iso: string } | { ok: false; error: string } {
  if (when.kind === "now") return { ok: true, iso: new Date(nowMs).toISOString() };
  if (when.kind === "yesterday") return { ok: true, iso: new Date(nowMs - DAY_MS).toISOString() };

  const dateKey = when.dateKey.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return { ok: false, error: "Enter the date as YYYY-MM-DD." };
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return { ok: false, error: "That date doesn't exist." };
  }
  const time = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(when.timeText.trim() || "12:00");
  if (!time) return { ok: false, error: "Enter the time as HH:MM, 24-hour." };

  const instant = new Date(
    kigaliDayBoundsUtc(dateKey).startUtc.getTime() +
      (Number(time[1]) * 60 + Number(time[2])) * 60_000,
  );
  if (instant.getTime() > nowMs + FUTURE_SLACK_MS) {
    return { ok: false, error: "That time is in the future." };
  }
  return { ok: true, iso: instant.toISOString() };
}

function parseAmount(text: string, currency: SupportedCurrency): bigint | null {
  try {
    return toMinorUnits(text, currency);
  } catch {
    return null;
  }
}

export function buildManualTransaction(
  form: ManualForm,
  account: ManualAccount,
  nowMs: number,
): BuildResult {
  const amount = parseAmount(form.amountText, account.currency);
  if (amount === null) return { ok: false, error: "Enter a valid amount." };
  if (amount <= BigInt(0)) return { ok: false, error: "Amount must be greater than zero." };
  if (amount > BigInt(MAX_MINOR)) return { ok: false, error: "That amount is too large." };

  // Fees are only modelled on money going out (as on the web and in ingestion).
  let fee = BigInt(0);
  if (form.direction === "out" && form.feeText.trim()) {
    const parsed = parseAmount(form.feeText, account.currency);
    if (parsed === null) return { ok: false, error: "Enter a valid fee amount." };
    if (parsed < BigInt(0)) return { ok: false, error: "Fee cannot be negative." };
    if (parsed > BigInt(MAX_MINOR)) return { ok: false, error: "That fee is too large." };
    fee = parsed;
  }

  const when = resolveWhen(form.when, nowMs);
  if (!when.ok) return when;

  const counterparty = form.counterpartyName.trim();
  const notes = form.notes.trim();
  if (counterparty.length > MAX_COUNTERPARTY) {
    return { ok: false, error: `Keep the name under ${MAX_COUNTERPARTY} characters.` };
  }
  if (notes.length > MAX_NOTES) {
    return { ok: false, error: `Keep the note under ${MAX_NOTES} characters.` };
  }

  const amountMinor = Number(amount);
  const feeMinor = Number(fee);
  const out = form.direction === "out";
  return {
    ok: true,
    row: {
      momo_message_id: null,
      account_id: account.id,
      workspace_id: account.workspaceId,
      source: "manual",
      transaction_type: form.transactionType,
      direction: form.direction,
      status: "success",
      currency: account.currency,
      amount_rwf: amountMinor,
      fee_rwf: feeMinor,
      principal_effect_rwf: out ? -amountMinor : amountMinor,
      fee_effect_rwf: out ? -feeMinor : 0,
      settlement_state: "settled",
      affects_balance: true,
      effect_reason: "manual_entry",
      counterparty_name: counterparty || null,
      occurred_at: when.iso,
      category: null,
      category_source: null,
      notes: notes || null,
      parser_version: "manual-entry-v1",
    },
  };
}
