import { buildTelHref, fillUssdTemplate, type ParamSpec } from "./capability";

// The eKash transfer code: *182*1*2*<receiver's ID>*<amount>#. eKash is the national
// interoperable engine behind Mobile Money and bank transfers, so the same code
// reaches a wallet (a phone number) or a bank account (an account number). Used by
// the "Use eKash" shortcut in the Pay sheet; the directory carries the same code as
// a browsable entry. Nothing here sends money: it only builds the text the user's
// own dialer will show, and the user approves it with their own PIN.

export const EKASH_TEMPLATE = "*182*1*2*{receiver}*{amount}#";

const SPECS: ParamSpec[] = [
  { key: "receiver", kind: "account_reference", required: true },
  { key: "amount", kind: "amount", required: true },
];

export type EkashCode = { ok: true; display: string; telHref: string } | { ok: false; error: string };

export function buildEkashCode(receiver: string, amount: string): EkashCode {
  const filled = fillUssdTemplate(EKASH_TEMPLATE, { receiver: receiver.trim().replace(/\s+/g, ""), amount: amount.trim() }, SPECS);
  return filled.ok ? { ok: true, display: filled.display, telHref: buildTelHref(filled.dial) } : { ok: false, error: filled.error };
}

/** What gets shared or copied: the code, and the user's own reference when they typed one. */
export function ekashShareText(code: string, reference: string): string {
  const ref = reference.trim();
  return ref ? `${code}\nReference: ${ref}` : code;
}
