import type { ScanModel } from "./types";

// Display rules for a classified scan, mirroring the web's review
// (web/components/pay/ScanToPay.tsx and web/lib/ussd/messages.ts). Pure.

export const CLASS_LABELS: Record<ScanModel["class"], string> = {
  verified_ussd: "Verified USSD code",
  provider_link: "Approved payment link",
  oneledger_payment: "OneLedger merchant code",
};

export const REASON_MESSAGES: Record<string, string> = {
  empty: "That code was empty.",
  too_long: "That code is too large to be a payment instruction.",
  control_chars: "That code contains characters a payment instruction never has.",
  deceptive_unicode: "That code uses hidden text tricks and was rejected.",
  unsafe_scheme: "That code tries to open something that isn't a payment. It was blocked.",
  embedded_credentials: "That link hides sign-in details and was rejected.",
  unknown_scheme: "OneLedger doesn't recognise this kind of code.",
  malformed_ussd: "That looks like a USSD code but it's malformed.",
  unknown_ussd: "That USSD code isn't in OneLedger's verified directory.",
  provider_not_allowlisted: "That link isn't from a payment provider OneLedger has approved.",
  lookalike_host: "That link imitates a known provider's address. It was blocked.",
  oneledger_schema: "That OneLedger code is malformed.",
  oneledger_expired: "That payment request has expired.",
  oneledger_replay: "That payment request has already been used.",
  amount_invalid: "That code's amount isn't valid.",
  currency_invalid: "That code's currency isn't supported.",
  emv_unsupported: "OneLedger doesn't support this merchant QR format yet.",
  emv_malformed: "That merchant QR is malformed or was tampered with.",
  multiple_codes: "More than one code was found. Try again with a single code.",
  not_recognised: "OneLedger couldn't recognise this code as a payment instruction.",
  needs_connection: "OneLedger needs a connection to check this code.",
};

export const FALLBACK_REASON = "OneLedger couldn't recognise this code as a payment instruction.";

export type ReviewRow = { label: string; value: string };

export type ScanReview = {
  rows: ReviewRow[];
  /** A verified USSD code with no amount: a menu or balance check, not a payment. */
  isMenu: boolean;
  /** Can be continued here: verified USSD, or a OneLedger merchant code in RWF. */
  isActionable: boolean;
  /** A OneLedger code with no amount: the user types it. */
  needsAmount: boolean;
  /** Why it can't be continued here, when it can't. */
  blocked: "currency" | "route" | null;
  notices: string[];
};

export function formatScanAmount(amount: { minor: number; currency: string }): string {
  // Only whole-unit currencies (RWF) reach the app's hand-off; others are shown as given.
  return `${amount.currency} ${amount.minor.toLocaleString("en-US")}`;
}

export function describeScan(model: ScanModel): ScanReview {
  const route = model.route;
  const isUssd = route.kind === "ussd" && route.literal != null;
  const isOneLedger = route.kind === "oneledger";
  const currency = route.kind === "oneledger" ? route.currency : null;
  const dial = route.kind === "ussd" ? route.literal : null;
  const isMenu = isUssd && !model.amount;
  const isActionable = isUssd || (isOneLedger && currency === "RWF");
  const needsAmount = isOneLedger && model.amountEditable;

  const rows: ReviewRow[] = [{ label: "Opens", value: CLASS_LABELS[model.class] }];
  if (model.providerLabel) rows.push({ label: "Provider", value: model.providerLabel });
  if (model.recipientMasked) rows.push({ label: "Pays", value: model.recipientMasked });
  if (model.amount) rows.push({ label: "Amount", value: formatScanAmount(model.amount) });
  if (model.reference) rows.push({ label: "Reference", value: model.reference });
  if (dial) rows.push({ label: "Code", value: dial });

  const notices: string[] = [];
  if (model.warnings.includes("merchant_unverified")) {
    notices.push("OneLedger can't confirm this merchant's identity. Check the details carefully before paying.");
  }
  if (model.warnings.includes("ussd_not_officially_verified")) {
    notices.push("This USSD code is published but not officially verified.");
  }
  if (isMenu) notices.push("This code opens a menu on your phone — it isn't a payment on its own.");

  const blocked = isActionable ? null : isOneLedger && currency !== "RWF" ? "currency" : "route";
  return { rows, isMenu, isActionable, needsAmount, blocked, notices };
}

export type AmountCheck =
  | { ok: true; minor: number }
  | { ok: false; reason: "required" | "not_a_number" | "not_positive" | "too_large" };

export const AMOUNT_ERRORS: Record<Exclude<AmountCheck, { ok: true }>["reason"], string> = {
  required: "Enter an amount.",
  not_a_number: "Enter a whole RWF amount, digits only.",
  not_positive: "Enter an amount greater than zero.",
  too_large: "That amount is too large.",
};

/** A whole-RWF amount typed by the user ("5,000" or "5 000"). RWF has no decimals. */
export function parseUserAmount(text: string): AmountCheck {
  const cleaned = text.replace(/[,\s]/g, "");
  if (cleaned === "") return { ok: false, reason: "required" };
  if (!/^\d+$/.test(cleaned)) return { ok: false, reason: "not_a_number" };
  const n = Number(cleaned);
  if (n <= 0) return { ok: false, reason: "not_positive" };
  if (n >= 1_000_000_000_000 || !Number.isSafeInteger(n)) return { ok: false, reason: "too_large" };
  return { ok: true, minor: n };
}

/** The string to show or copy for a prepared route: `tel:*182*...%23` → `*182*...#`. */
export function dialFromTel(telHref: string): string {
  return telHref.replace(/^tel:/i, "").replace(/%23/g, "#");
}
