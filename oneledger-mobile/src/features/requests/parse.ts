import { failureForStatus, type BearerFailure } from "@/api/bearer";
import type { SupportedCurrency } from "@/lib/money";

import { isShareableLink } from "./input";
import type { MatchCandidate, PaymentRequest, RequestStatus } from "./types";

const STATUSES: readonly RequestStatus[] = ["open", "expired", "cancelled", "marked_paid_by_owner", "matched"];
const CURRENCIES: readonly SupportedCurrency[] = ["RWF", "EUR", "USD"];

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === "string" && v.length > 0;

function amount(v: unknown): bigint | null {
  if (typeof v === "number") return Number.isSafeInteger(v) && v > 0 ? BigInt(v) : null;
  if (typeof v === "string" && /^[1-9]\d{0,18}$/.test(v)) return BigInt(v);
  return null;
}

/** A row of payment_requests_v as PostgREST returns it. */
export function parseRequestRow(raw: unknown): PaymentRequest | null {
  if (!isRecord(raw) || !str(raw.id) || !str(raw.workspace_id) || !str(raw.recipient_display) || !str(raw.destination_value)) return null;
  if (!STATUSES.includes(raw.status as RequestStatus) || !CURRENCIES.includes(raw.currency as SupportedCurrency)) return null;
  if (raw.destination_type !== "momo_phone" && raw.destination_type !== "merchant_code") return null;
  const a = amount(raw.amount_minor);
  if (a === null || !str(raw.expires_at) || !str(raw.created_at)) return null;
  return {
    id: raw.id,
    workspaceId: raw.workspace_id,
    amountMinor: a,
    currency: raw.currency as SupportedCurrency,
    destinationType: raw.destination_type,
    destinationValue: raw.destination_value,
    recipientDisplay: raw.recipient_display,
    reference: typeof raw.reference === "string" ? raw.reference : null,
    expiresAt: raw.expires_at,
    status: raw.status as RequestStatus,
    matchedTransactionId: typeof raw.matched_transaction_id === "string" ? raw.matched_transaction_id : null,
    createdAt: raw.created_at,
  };
}

export function parseCandidate(raw: unknown): MatchCandidate | null {
  if (!isRecord(raw) || !str(raw.id) || !str(raw.occurred_at)) return null;
  return { id: raw.id, occurredAt: raw.occurred_at, counterpartyName: typeof raw.counterparty_name === "string" ? raw.counterparty_name : null };
}

export type CreateResult =
  /** `url` is null on an idempotent replay: the link can't be shown again. */
  | { ok: true; id: string; url: string | null }
  | { ok: false; message: string; reason?: BearerFailure["reason"] };

export function parseCreateResponse(status: number, body: unknown): CreateResult {
  if (status === 200 && isRecord(body) && body.ok === true && str(body.id)) {
    if (body.url === null) return { ok: true, id: body.id, url: null };
    // Only a link of exactly the expected shape is ever offered for sharing.
    if (isShareableLink(body.url)) return { ok: true, id: body.id, url: body.url };
    return { ok: false, message: "Something went wrong. Please try again." };
  }
  if (status === 422 && isRecord(body) && typeof body.message === "string" && body.message.length <= 300) {
    return { ok: false, message: body.message };
  }
  if (status === 400) return { ok: false, message: "Check the details and try again." };
  const f = failureForStatus(status, "Payment requests");
  return { ok: false, message: f.message, reason: f.reason };
}
