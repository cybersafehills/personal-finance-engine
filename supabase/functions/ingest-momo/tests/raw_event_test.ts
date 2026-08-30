// Phase U (PR2): unit coverage for the pure builders that feed the
// raw_financial_events cutover and transaction-level duplicate detection.
// index.ts has no test harness of its own, so the logic that must be
// right - the evidence-row shape, the fingerprint arguments, and the
// "never block ingestion" dedupe rule - lives here where it can be
// asserted directly.

import { assertEquals } from "jsr:@std/assert@1";
import {
  buildRawFinancialEvent,
  deriveDedupeState,
  fingerprintArgs,
} from "../raw-event.ts";
import type { ParsedTransaction } from "../types.ts";

const PARSED: ParsedTransaction = {
  external_transaction_id: "MP2408271234",
  transaction_type: "merchant_payment",
  direction: "out",
  status: "success",
  amount_rwf: 5000,
  fee_rwf: 0,
  balance_after_rwf: 12000,
  counterparty_name: "  SIMBA   SUPERMARKET ",
  counterparty_reference: null,
  occurred_at: "2026-08-27T09:15:30Z",
  metadata: {},
};

Deno.test("buildRawFinancialEvent: sms evidence row, deduped on the normalized-message hash", () => {
  const row = buildRawFinancialEvent({
    rawMessage:
      "You have paid RWF 5,000 to SIMBA SUPERMARKET. Ref: MP2408271234",
    payloadHash: "abc123",
    deviceReceivedAt: "2026-08-27T09:16:00Z",
    ingestionConnectionId: "conn-1",
    financialSourceId: "source-1",
    connectorInstallationId: "install-1",
    deviceCredentialId: "credential-1",
    momoMessageId: "msg-1",
    parserVersion: "momo-parser-v1.1",
    now: "2026-08-27T09:20:00Z",
  });

  assertEquals(row.channel, "sms");
  assertEquals(row.payload_hash, "abc123");
  assertEquals(row.ingestion_connection_id, "conn-1");
  assertEquals(row.financial_source_id, "source-1");
  assertEquals(row.connector_installation_id, "install-1");
  assertEquals(row.device_credential_id, "credential-1");
  assertEquals(row.parse_status, "pending");
  assertEquals(row.parser_version, "momo-parser-v1.1");
  // device time wins when present
  assertEquals(row.received_at, "2026-08-27T09:16:00Z");
  assertEquals(row.raw_payload.momo_message_id, "msg-1");
  assertEquals(row.raw_payload.ingestion_source, "iphone_shortcuts");
});

Deno.test("buildRawFinancialEvent: falls back to the server clock when the device sent no timestamp", () => {
  const row = buildRawFinancialEvent({
    rawMessage: "x",
    payloadHash: "h",
    deviceReceivedAt: null,
    ingestionConnectionId: "conn-1",
    financialSourceId: "source-1",
    connectorInstallationId: "install-1",
    deviceCredentialId: "credential-1",
    momoMessageId: "msg-1",
    parserVersion: "v",
    now: "2026-08-27T09:20:00Z",
  });

  assertEquals(row.received_at, "2026-08-27T09:20:00Z");
  assertEquals(row.raw_payload.device_received_at, null);
});

Deno.test("fingerprintArgs: RWF amount is already minor units; defaults to the mtn_momo source", () => {
  const args = fingerprintArgs(PARSED);

  assertEquals(args.p_source, "mtn_momo");
  assertEquals(args.p_masked_identifier, "");
  assertEquals(args.p_amount_minor, 5000);
  assertEquals(args.p_currency, "RWF");
  assertEquals(args.p_direction, "out");
  assertEquals(args.p_counterparty, "  SIMBA   SUPERMARKET ");
  assertEquals(args.p_occurred_at, "2026-08-27T09:15:30Z");
});

Deno.test("fingerprintArgs: threads through the source's masked identifier when the account has one", () => {
  const args = fingerprintArgs(PARSED, { maskedIdentifier: "MTN ...4821" });
  assertEquals(args.p_masked_identifier, "MTN ...4821");
});

Deno.test("fingerprintArgs: a null counterparty becomes an empty string, never the literal 'null'", () => {
  const args = fingerprintArgs({ ...PARSED, counterparty_name: null });
  assertEquals(args.p_counterparty, "");
});

Deno.test("deriveDedupeState: any visible same-fingerprint peer means possible_duplicate", () => {
  assertEquals(deriveDedupeState(1), "possible_duplicate");
  assertEquals(deriveDedupeState(3), "possible_duplicate");
});

Deno.test("deriveDedupeState: no peers - and, by the caller's contract, a failed lookup passed as 0 - stays unique", () => {
  assertEquals(deriveDedupeState(0), "unique");
});
