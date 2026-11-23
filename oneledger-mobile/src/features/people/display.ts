import { formatMoney } from "@/lib/money";

import type { Person, PersonConfidence, PersonCurrency, PersonKind } from "./types";

export const KIND_LABEL: Record<PersonKind, string> = {
  self: "My account",
  person: "Person",
  merchant: "Merchant",
  unknown: "Not sure yet",
};

export const KIND_VARIANT: Record<PersonKind, "accent" | "positive" | "neutral"> = {
  self: "neutral",
  person: "accent",
  merchant: "positive",
  unknown: "neutral",
};

/** Why we grouped transactions this way, in plain words. Empty when there is nothing to caveat. */
export function confidenceNote(c: PersonConfidence): string | null {
  if (c === "low") return "Grouped by name only - two different people with the same name would appear together.";
  return null;
}

export function confidenceLabel(c: PersonConfidence): string {
  return c === "user_confirmed" ? "You confirmed this" : c === "high" ? "Matched by phone number or code" : "Matched by name only";
}

/** "You sent RWF 10,100" / "You received RWF 5,000" / both, for one currency. */
export function flowText(c: PersonCurrency): string {
  const parts: string[] = [];
  if (c.sentMinor > BigInt(0)) parts.push(`You sent ${formatMoney(c.sentMinor, c.currency)}`);
  if (c.receivedMinor > BigInt(0)) parts.push(`You received ${formatMoney(c.receivedMinor, c.currency)}`);
  return parts.length ? parts.join(" · ") : "No money moved";
}

export function personSummary(p: Person): string {
  const first = p.currencies[0];
  return `${p.displayName}, ${KIND_LABEL[p.kind]}${first ? `, ${flowText(first)}` : ""}, ${p.txnCount} ${p.txnCount === 1 ? "transaction" : "transactions"}`;
}

/** A safe sentence for each database refusal; never raw text. */
export function friendlyPeopleError(raw: string | null | undefined): string {
  const s = raw ?? "";
  if (/counterparty_merged/.test(s)) return "This was already combined with another. Open the other one.";
  if (/merge_state_changed|split_state_changed/.test(s)) return "Something changed since then. Undo the later change first.";
  if (/split_would_empty/.test(s)) return "You can't move everything. Rename it instead.";
  if (/already_undone/.test(s)) return "That was already undone.";
  if (/invalid_merge|invalid_split|invalid_counterparty/.test(s)) return "That change isn't allowed. Check your choices.";
  if (/not_found/.test(s)) return "That couldn't be found.";
  return "Couldn't save that. Check your connection and try again.";
}

/** The Insights screen's counterparty key -> a person id, or null for a name-only group. */
export function personIdFromKey(key: string): string | null {
  return /^id:[0-9a-f-]{36}$/i.test(key) ? key.slice(3) : null;
}
