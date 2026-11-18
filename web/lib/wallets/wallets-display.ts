// Wording and input rules for the Wallets page. PURE: no I/O. The labels and
// meanings are the SAME words the mobile Wallets screen uses
// (oneledger-mobile/src/features/wallets/display.ts) so the two surfaces can
// never describe one balance differently.

import type { BalanceReason, BalanceStatus } from "../balance-status.ts";
import { isSupportedCurrency, minorUnitsPerMajor } from "../money.ts";

export const STATUS_LABEL: Record<BalanceStatus, string> = {
  confirmed: "Confirmed",
  estimated: "Estimated",
  stale: "Out of date",
  unavailable: "Not available",
};

/** Badge variants (components/Badge.tsx) - the same mapping as the app. */
export const STATUS_VARIANT: Record<
  BalanceStatus,
  "positive" | "accent" | "attention" | "neutral"
> = {
  confirmed: "positive",
  estimated: "accent",
  stale: "attention",
  unavailable: "neutral",
};

export const STATUS_MEANING: Record<BalanceStatus, string> = {
  confirmed: "The balance your provider reported in its last message.",
  estimated:
    "Worked out from a balance we know plus what happened since. It may differ from your provider.",
  stale: "The last balance we know. It may no longer be right.",
  unavailable: "We don't have a balance for this wallet yet.",
};

const REASON_TEXT: Record<BalanceReason, string> = {
  no_baseline: "No provider message with a balance yet.",
  baseline_old: "The last balance is more than a week old.",
  unresolved_activity: "Some recent activity isn't settled or sorted yet.",
  reconciliation_mismatch:
    "Messages since then don't add up - one may be missing.",
  user_stated_baseline: "Based on the balance you entered.",
  activity_since_baseline: "Includes transactions since that balance.",
};
export const reasonText = (r: BalanceReason): string => REASON_TEXT[r];

export const PROVIDER_LABEL: Record<string, string> = {
  mtn_momo: "MTN MoMo",
  airtel_money: "Airtel Money",
  bank: "Bank",
  card: "Card",
  cash: "Cash",
  other: "Other",
};

export type ParsedBalance =
  | { ok: true; amountMinor: bigint }
  | { ok: false; error: string };

/**
 * Limit on MINOR-unit digits. 15 digits is below 2^53, so the value is
 * exact both as a Postgres bigint and when PostgREST returns it as a JSON
 * number - for every currency, not only zero-decimal ones.
 */
const MAX_MINOR_DIGITS = 15;

/**
 * A typed balance -> minor units of the wallet's currency. Zero is a valid
 * balance. Never rounds: "78900.505" for a 2-decimal currency is refused,
 * not saved as 78900.51. A currency whose decimal places are not known is
 * refused rather than guessed.
 */
export function parseBalanceInput(
  text: string,
  currency: string,
): ParsedBalance {
  if (!isSupportedCurrency(currency)) {
    return {
      ok: false,
      error: `Balances in ${currency} can't be entered yet.`,
    };
  }
  const per = minorUnitsPerMajor(currency);
  const decimals = per.toString().length - 1;
  const example = decimals === 0 ? "78,900" : "78,900.50";
  const invalid: ParsedBalance = {
    ok: false,
    error: decimals === 0
      ? `Enter a whole number, like ${example}.`
      : `Enter an amount, like ${example}.`,
  };
  const cleaned = text.replace(/[,\s]/g, "");
  const m = /^(\d+)(?:\.(\d+))?$/.exec(cleaned);
  if (!m) return invalid;
  const frac = m[2] ?? "";
  if (frac.length > decimals && /[1-9]/.test(frac.slice(decimals))) {
    return invalid;
  }
  const digits = m[1] + frac.padEnd(decimals, "0").slice(0, decimals);
  if (digits.replace(/^0+/, "").length > MAX_MINOR_DIGITS) {
    return { ok: false, error: "That amount is too large." };
  }
  return { ok: true, amountMinor: BigInt(digits) };
}

export type WalletForTotal = {
  currency: string;
  status: BalanceStatus;
  amountMinor: bigint | null;
};

export type CurrencyTotal = {
  currency: string;
  /** Sum of the wallets that have a number. */
  totalMinor: bigint;
  counted: number;
  /** Wallets with no balance at all - NOT in the total. */
  unavailable: number;
  /** True when every counted figure is provider-confirmed. */
  allConfirmed: boolean;
  /** Counted figures that are estimates or out of date. */
  uncertain: number;
};

/**
 * Adds up known balances per currency (never across currencies). The result
 * carries how sure it is, so the page can never present a sum of estimates
 * as a live total.
 */
export function totalsByCurrency(
  wallets: readonly WalletForTotal[],
): CurrencyTotal[] {
  const m = new Map<string, CurrencyTotal>();
  for (const w of wallets) {
    const t = m.get(w.currency) ?? {
      currency: w.currency,
      totalMinor: 0n,
      counted: 0,
      unavailable: 0,
      allConfirmed: true,
      uncertain: 0,
    };
    if (w.amountMinor === null) t.unavailable++;
    else {
      t.totalMinor += w.amountMinor;
      t.counted++;
      if (w.status !== "confirmed") {
        t.allConfirmed = false;
        t.uncertain++;
      }
    }
    m.set(w.currency, t);
  }
  return [...m.values()]
    .map((t) => ({ ...t, allConfirmed: t.counted > 0 && t.allConfirmed }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

/**
 * One plain sentence on how a wallet's balance stays current - so "No balance
 * yet" always comes with the way out. basis: where the figure came from.
 */
export function updateHint(
  basis: "provider_reported" | "manual" | null,
  hasBalance: boolean,
): string {
  if (!hasBalance) {
    return "To get a balance here: connect this wallet's phone so its messages arrive, import a statement, or enter the balance you see.";
  }
  return basis === "manual"
    ? "You entered this balance. Check your provider and enter it again whenever you like to keep it fresh."
    : "Updates by itself each time this wallet's phone sends a new message.";
}
