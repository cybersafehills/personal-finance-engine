// Pure helpers for the web People & merchants pages (docs/oneledger-3/
// s6c-web-people.md). Same words and rules as the Expo screens
// (oneledger-mobile/src/features/people/display.ts) so the two surfaces
// never explain a person differently. No I/O; deno-testable.

import { formatMoney, isSupportedCurrency } from "../money.ts";
import { isOneLedger3FlagEnabled } from "../oneledger3-flags.ts";
import type { MobileCounterparty } from "./mobile.ts";

export type PersonKind = "person" | "merchant" | "unknown";

export const KIND_LABEL: Record<PersonKind, string> = {
  person: "Person",
  merchant: "Merchant",
  unknown: "Not sure yet",
};

export const KIND_FILTERS: readonly { value: PersonKind | null; label: string }[] = [
  { value: null, label: "All" },
  { value: "person", label: "People" },
  { value: "merchant", label: "Merchants" },
  { value: "unknown", label: "Not sure yet" },
];

export function isPersonKind(v: unknown): v is PersonKind {
  return v === "person" || v === "merchant" || v === "unknown";
}

/** Same opt-in flag + workspace allowlist as /api/mobile/counterparties. */
export function isCounterpartiesEnabledFor(
  env: Record<string, string | undefined>,
  workspaceId: string | null,
): boolean {
  return isOneLedger3FlagEnabled(env, "COUNTERPARTIES", workspaceId);
}

/** Why we grouped transactions this way, in plain words. */
export function confidenceLabel(c: string): string {
  if (c === "user_confirmed") return "You confirmed this";
  if (c === "high") return "Matched by phone number or code";
  return "Matched by name only";
}

/** Empty when there is nothing to caveat. */
export function confidenceNote(c: string): string | null {
  return c === "low"
    ? "Grouped by name only - two different people with the same name would appear together."
    : null;
}

/**
 * An amount in the minor units of `currency`. Unsupported currencies are shown
 * as "CODE 1234" with no decimal guess, never as a wrongly scaled number.
 */
export function formatMinor(amountMinor: bigint | string, currency: string): string {
  const v = typeof amountMinor === "bigint" ? amountMinor : BigInt(amountMinor);
  if (isSupportedCurrency(currency)) return formatMoney(v, currency);
  return `${currency} ${v.toString()}`;
}

/** "You sent RWF 10,100" / "You received RWF 5,000" / both, for one currency. */
export function flowText(c: MobileCounterparty["currencies"][number]): string {
  const parts: string[] = [];
  if (BigInt(c.sent_minor) > 0n) parts.push(`You sent ${formatMinor(c.sent_minor, c.currency)}`);
  if (BigInt(c.received_minor) > 0n) {
    parts.push(`You received ${formatMinor(c.received_minor, c.currency)}`);
  }
  return parts.length ? parts.join(" · ") : "No money moved";
}

/** A safe sentence for each database refusal; never raw text. */
export function friendlyPeopleError(raw: string | null | undefined): string {
  const s = raw ?? "";
  if (/counterparty_merged/.test(s)) {
    return "This was already combined with another. Open the other one.";
  }
  if (/merge_state_changed|split_state_changed/.test(s)) {
    return "Something changed since then. Undo the later change first.";
  }
  if (/split_would_empty/.test(s)) return "You can't move everything. Rename it instead.";
  if (/already_undone/.test(s)) return "That was already undone.";
  if (/invalid_merge|invalid_split|invalid_counterparty/.test(s)) {
    return "That change isn't allowed. Check your choices.";
  }
  if (/not_found/.test(s)) return "That couldn't be found.";
  return "Couldn't save that. Try again.";
}

export const PAGE_SIZE = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: string): boolean => UUID.test(v);

export type DirectoryQuery = {
  q: string | null;
  kind: PersonKind | null;
  page: number;
};

type Raw = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined): string | undefined => Array.isArray(v) ? v[0] : v;

/**
 * Lenient URL parsing for a page a person can edit by hand: anything invalid
 * falls back to the default rather than erroring. Search text has the ILIKE
 * wildcard characters stripped (same rule as the mobile API) and is capped.
 */
export function parseDirectoryQuery(sp: Raw): DirectoryQuery {
  const rawQ = first(sp.q);
  const cleaned = rawQ === undefined ? "" : rawQ.replace(/[%_\\,()*]/g, " ").trim().slice(0, 80);
  const kindRaw = first(sp.kind);
  const pageRaw = Number(first(sp.page) ?? 1);
  return {
    q: cleaned === "" ? null : cleaned,
    kind: isPersonKind(kindRaw) ? kindRaw : null,
    page: Number.isInteger(pageRaw) && pageRaw >= 1 && pageRaw <= 10_000 ? pageRaw : 1,
  };
}

/** A /people URL keeping only non-default parts, so shared links stay short. */
export function directoryHref(q: DirectoryQuery): string {
  const p = new URLSearchParams();
  if (q.q) p.set("q", q.q);
  if (q.kind) p.set("kind", q.kind);
  if (q.page > 1) p.set("page", String(q.page));
  const s = p.toString();
  return s ? `/people?${s}` : "/people";
}

/** Page number -> the offset/limit pair the loaders take. */
export function pageWindow(page: number): { limit: number; offset: number } {
  return { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE };
}
