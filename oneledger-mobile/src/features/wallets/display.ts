import { formatDateTime } from "@/lib/kigali-time";
import { formatAmount } from "../../../../web/shared/financial";

import type { BalanceReason, BalanceStatus, Wallet } from "./types";

export const STATUS_LABEL: Record<BalanceStatus, string> = {
  confirmed: "Confirmed",
  estimated: "Estimated",
  stale: "Out of date",
  unavailable: "Not available",
};

export const STATUS_VARIANT: Record<BalanceStatus, "positive" | "accent" | "attention" | "neutral"> = {
  confirmed: "positive",
  estimated: "accent",
  stale: "attention",
  unavailable: "neutral",
};

/** What each label means, in plain words (shown under the balance). */
export const STATUS_MEANING: Record<BalanceStatus, string> = {
  confirmed: "The balance your provider reported in its last message.",
  estimated: "Worked out from a balance we know plus what happened since. It may differ from your provider.",
  stale: "The last balance we know. It may no longer be right.",
  unavailable: "We don't have a balance for this wallet yet.",
};

const REASON_TEXT: Record<BalanceReason, string> = {
  no_baseline: "No provider message with a balance yet.",
  baseline_old: "The last balance is more than a week old.",
  unresolved_activity: "Some recent activity isn't settled or sorted yet.",
  reconciliation_mismatch: "Messages since then don't add up - one may be missing.",
  user_stated_baseline: "Based on the balance you entered.",
  activity_since_baseline: "Includes transactions since that balance.",
};
export const reasonText = (r: BalanceReason): string => REASON_TEXT[r];

/** "RWF 78,900" or "No balance yet" - a number only when the status supports one. */
export function balanceText(w: Wallet): string {
  return w.balance.amountMinor === null ? "No balance yet" : formatAmount(w.balance.amountMinor, w.currency, false);
}

export function asOfText(w: Wallet): string | null {
  return w.balance.asOf ? `As of ${formatDateTime(w.balance.asOf)}` : null;
}

export const PROVIDER_LABEL: Record<string, string> = {
  mtn_momo: "MTN MoMo", airtel_money: "Airtel Money", bank: "Bank", card: "Card", cash: "Cash", other: "Other",
};

/** Typed amount -> minor units for recording a balance; null when not a plain non-negative number. */
export function parseBalanceInput(text: string, decimals: number): bigint | null {
  const cleaned = text.replace(/[,\s]/g, "");
  const m = /^(\d+)(?:\.(\d+))?$/.exec(cleaned);
  if (!m) return null;
  const frac = (m[2] ?? "").padEnd(decimals, "0").slice(0, decimals);
  if ((m[2] ?? "").length > decimals && /[1-9]/.test((m[2] ?? "").slice(decimals))) return null; // never silently round a balance
  return BigInt(m[1] + frac);
}
