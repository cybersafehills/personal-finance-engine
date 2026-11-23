import { buildTelHref, fillUssdTemplate, type ParamSpec } from "./capability";

// The eKash transfer code: *182*1*2*<receiver's ID>*<amount>#. eKash is the national
// interoperable engine behind Mobile Money and bank transfers, so the same code
// reaches a wallet (a phone number) or a bank account (an account number). Used by
// the "Use eKash" shortcut in the Pay sheet; the directory carries the same code as
// a browsable entry. Nothing here sends money: it only builds the text the user's
// own dialer will show, and the user approves it with their own PIN.

export const EKASH_TEMPLATE = "*182*1*2*{receiver}*{amount}#";

const SPECS: ParamSpec[] = [
  { key: "amount", kind: "amount", required: true },
];

export type EkashCode = { ok: true; display: string; telHref: string } | { ok: false; error: string };

/** Preserve bank IDs, including leading zeroes and separators; never let an ID rewrite a USSD path. */
export function normalizeAccountReference(value: string): string | null {
  const ref = value.trim().replace(/\s+/g, "");
  return /^[A-Za-z0-9][A-Za-z0-9./_-]{2,63}$/.test(ref) && /[A-Za-z0-9]$/.test(ref) ? ref : null;
}

export function buildEkashCode(receiver: string, amount: string): EkashCode {
  const normalized = normalizeAccountReference(receiver);
  if (!normalized) return { ok: false, error: "Enter the phone or account number using letters, digits, dots, dashes, underscores or slashes. Do not include * or #." };
  // This route supports account formats beyond the directory's generic account_reference rule.
  const filled = fillUssdTemplate(EKASH_TEMPLATE.replace("{receiver}", normalized), { amount: amount.trim() }, SPECS);
  return filled.ok ? { ok: true, display: filled.display, telHref: buildTelHref(filled.dial) } : { ok: false, error: filled.error };
}

/** What gets shared or copied: the code, and the user's own reference when they typed one. */
export function ekashShareText(code: string, reference: string): string {
  const ref = reference.trim();
  return ref ? `${code}\nReference: ${ref}` : code;
}
