// Phase U (PR2): the ingest-momo cutover to the raw_financial_events spine
// and to transaction-level duplicate detection.
//
// Pure, side-effect-free builders factored out of index.ts so they can be
// unit-tested without a live database or HTTP server (index.ts has no
// test harness of its own - parser/policy-engine/connection-resolver are
// each extracted for exactly this reason).
//
// Nothing here decides routing or balance. raw_financial_events is written
// as upstream evidence (payload_hash-deduped, never discarded - design
// doc §4.5); the canonical transaction still routes exactly as it did
// before this PR (the connection's bound workspace/account). The only new
// signals written onto the transaction are dedupe_fingerprint /
// dedupe_state, and they never block or merge anything in this PR -
// possible_duplicate rows are surfaced for human review in a later PR.

import type { ParsedTransaction } from "./types.ts";

export type RawFinancialEventInsert = {
  channel: "sms";
  received_at: string;
  payload_hash: string;
  raw_payload: Record<string, unknown>;
  ingestion_connection_id: string;
  financial_source_id: string;
  connector_installation_id: string;
  device_credential_id: string;
  parser_version: string;
  parse_status: "pending";
};

/**
 * The raw_financial_events row for one inbound MoMo SMS. `payloadHash` is
 * the same normalized-message SHA-256 that momo_messages dedupes on, so the
 * same SMS redelivered by this connection collapses to one evidence row here
 * too. The connection is part of the uniqueness scope so identical provider
 * text belonging to another customer remains independent.
 */
export function buildRawFinancialEvent(input: {
  rawMessage: string;
  payloadHash: string;
  deviceReceivedAt: string | null;
  ingestionConnectionId: string;
  financialSourceId: string;
  connectorInstallationId: string;
  deviceCredentialId: string;
  momoMessageId: string;
  parserVersion: string;
  now: string;
}): RawFinancialEventInsert {
  return {
    channel: "sms",
    received_at: input.deviceReceivedAt ?? input.now,
    payload_hash: input.payloadHash,
    raw_payload: {
      ingestion_source: "iphone_shortcuts",
      raw_message: input.rawMessage,
      momo_message_id: input.momoMessageId,
      device_received_at: input.deviceReceivedAt,
    },
    ingestion_connection_id: input.ingestionConnectionId,
    financial_source_id: input.financialSourceId,
    connector_installation_id: input.connectorInstallationId,
    device_credential_id: input.deviceCredentialId,
    parser_version: input.parserVersion,
    parse_status: "pending",
  };
}

export type FingerprintArgs = {
  p_source: string;
  p_masked_identifier: string;
  p_amount_minor: number;
  p_currency: string;
  p_direction: string;
  p_counterparty: string;
  p_occurred_at: string;
};

/**
 * Arguments for the compute_transaction_fingerprint(...) RPC. RWF is a
 * zero-decimal currency, so amount_rwf is already the minor unit.
 */
export function fingerprintArgs(
  parsed: Pick<
    ParsedTransaction,
    "amount_rwf" | "direction" | "counterparty_name" | "occurred_at"
  >,
  opts: {
    source?: string;
    maskedIdentifier?: string | null;
    currency?: string;
  } = {},
): FingerprintArgs {
  return {
    p_source: opts.source ?? "mtn_momo",
    p_masked_identifier: opts.maskedIdentifier ?? "",
    p_amount_minor: parsed.amount_rwf,
    p_currency: opts.currency ?? "RWF",
    p_direction: parsed.direction,
    p_counterparty: parsed.counterparty_name ?? "",
    p_occurred_at: parsed.occurred_at,
  };
}

export type DedupeState = "unique" | "possible_duplicate";

/**
 * How to stamp transactions.dedupe_state at ingestion time. A non-empty
 * candidate set (same fingerprint, not already merged, visible to the
 * ingestion role) means "possible_duplicate" - surfaced for review, never
 * auto-merged here. Anything else, including a failed/empty fingerprint
 * lookup, is "unique": ingestion must never be blocked by dedupe.
 */
export function deriveDedupeState(candidateCount: number): DedupeState {
  return candidateCount > 0 ? "possible_duplicate" : "unique";
}
