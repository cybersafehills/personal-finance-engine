import { failureForStatus, type BearerFailure } from "@/api/bearer";
import { minor, parseTransaction } from "@/features/insights/parse";
import type { SupportedCurrency } from "@/lib/money";

import type { Person, PersonConfidence, PersonCurrency, PersonDetail, PersonKind } from "./types";

const KINDS: readonly PersonKind[] = ["person", "merchant", "unknown"];
const CONFIDENCES: readonly PersonConfidence[] = ["user_confirmed", "high", "low"];
const CURRENCIES: readonly SupportedCurrency[] = ["RWF", "EUR", "USD"];

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const int = (v: unknown): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;

function currency(raw: unknown): PersonCurrency | null {
  if (!isRecord(raw) || !CURRENCIES.includes(raw.currency as SupportedCurrency)) return null;
  const sent = minor(raw.sent_minor), recv = minor(raw.received_minor), net = minor(raw.net_minor);
  const n = int(raw.txn_count);
  if (sent === null || recv === null || net === null || n === null) return null;
  return { currency: raw.currency as SupportedCurrency, sentMinor: sent, receivedMinor: recv, netMinor: net, txnCount: n };
}

export function parsePerson(raw: unknown): Person | null {
  if (!isRecord(raw) || !str(raw.id) || !str(raw.display_name)) return null;
  if (!KINDS.includes(raw.kind as PersonKind) || !CONFIDENCES.includes(raw.confidence as PersonConfidence)) return null;
  const n = int(raw.txn_count);
  if (n === null) return null;
  return {
    id: raw.id,
    displayName: raw.display_name,
    kind: raw.kind as PersonKind,
    confidence: raw.confidence as PersonConfidence,
    txnCount: n,
    firstAt: typeof raw.first_at === "string" ? raw.first_at : null,
    lastAt: typeof raw.last_at === "string" ? raw.last_at : null,
    currencies: (Array.isArray(raw.currencies) ? raw.currencies : [])
      .map(currency)
      .filter((c): c is PersonCurrency => c !== null),
  };
}

export type PeopleResult =
  | { ok: true; workspaceId: string; total: number; unresolved: number; people: Person[] }
  | ({ ok: false } & BearerFailure);

export function parsePeopleResponse(status: number, body: unknown): PeopleResult {
  if (status !== 200 || !isRecord(body) || body.ok !== true || !Array.isArray(body.counterparties) || !str(body.workspace_id)) {
    return { ok: false, ...failureForStatus(status, "People and merchants") };
  }
  const total = int(body.total), unresolved = int(body.unresolved_transactions);
  if (total === null || unresolved === null) return { ok: false, ...failureForStatus(500, "People and merchants") };
  return {
    ok: true,
    workspaceId: body.workspace_id,
    total,
    unresolved,
    people: body.counterparties.map(parsePerson).filter((p): p is Person => p !== null),
  };
}

export type PersonResult =
  | { ok: true; workspaceId: string; detail: PersonDetail }
  /** This one was combined into another; go there instead. */
  | { ok: false; reason: "merged"; survivorId: string; message: string }
  | ({ ok: false } & BearerFailure);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parsePersonResponse(status: number, body: unknown): PersonResult {
  if (status === 409 && isRecord(body) && typeof body.error === "string" && body.error.startsWith("merged_into:")) {
    const survivorId = body.error.slice("merged_into:".length);
    if (UUID.test(survivorId)) {
      return { ok: false, reason: "merged", survivorId, message: "This was combined with another." };
    }
  }
  if (status !== 200 || !isRecord(body) || body.ok !== true || !str(body.workspace_id)) {
    return { ok: false, ...failureForStatus(status, "This person") };
  }
  const person = parsePerson(isRecord(body.counterparty) ? { txn_count: 0, ...body.counterparty } : null);
  const total = int(body.total_transactions);
  if (!person || total === null || !Array.isArray(body.transactions)) {
    return { ok: false, ...failureForStatus(500, "This person") };
  }
  const mergedFrom = (Array.isArray(body.merged_from) ? body.merged_from : [])
    .filter((m): m is { id: string; display_name: string } => isRecord(m) && str(m.id) && str(m.display_name))
    .map((m) => ({ id: m.id, displayName: m.display_name }));
  return {
    ok: true,
    workspaceId: body.workspace_id,
    detail: {
      person,
      mergedFrom,
      totalTransactions: total,
      transactions: body.transactions.map(parseTransaction).filter((t): t is NonNullable<typeof t> => t !== null),
    },
  };
}
