import { type Keyring, seal } from "../_shared/sensitive-crypto.ts";
import {
  kwhToMilli,
  meterLast4,
  parseUtilityReceipt,
  redactUtilityToken,
  vendorRefHash,
} from "../ingest-momo/utility-receipt.ts";

// Processes ONE captured prepaid-electricity receipt (provider_key
// "utility_receipt", ADR 0020). Unlike a MoMo SMS it never becomes a
// transaction: it becomes a utility_receipts row that the database links to the
// MoMo payment (now or when that payment arrives). Dependencies are injected so
// this is unit-testable without a database.
//
// Privacy by construction: the token is encrypted before it leaves this
// function (and only when capture is on AND a key is configured - otherwise it
// is simply not kept); the meter is reduced to its last 4 digits; the meter
// owner's name is never read; and afterwards the raw evidence row is rewritten
// with the token removed. Nothing here logs a value.

export type UtilityOutcome = "processed" | "superseded" | "failed" | "retried";

export type UtilityDeps = {
  storeReceipt(args: {
    id: string;
    workspaceId: string;
    format: string;
    amountRwf: number;
    kwhMilli: number;
    meterLast4: string | null;
    vendorRefHash: string;
    receiptAt: string;
    tokenKeyId: string | null;
    tokenNonce: string | null;
    tokenCiphertext: string | null;
  }): Promise<{ ok: true; created: boolean; status: string } | { ok: false }>;
  /** Replace the raw message in the evidence row and set its parse status. */
  finalize(
    patch: {
      parseStatus: "normalized" | "rejected" | "superseded";
      rawMessage: string | null;
    },
  ): Promise<void>;
};

export async function processUtilityReceipt(args: {
  rawMessage: string;
  deviceReceivedAt: string | null;
  eventReceivedAt: string;
  workspaceId: string;
  attempts: number;
  captureEnabled: boolean;
  ring: Keyring | null;
  deps: UtilityDeps;
}): Promise<UtilityOutcome> {
  const parsed = parseUtilityReceipt(args.rawMessage);
  const milli = parsed ? kwhToMilli(parsed.kwh) : null;
  if (!parsed || milli === null) {
    // Detected as a receipt on the phone but not parseable: keep nothing sensitive.
    await args.deps.finalize({
      parseStatus: "rejected",
      rawMessage: redactUtilityToken(args.rawMessage),
    });
    return "failed";
  }

  const t = Date.parse(args.deviceReceivedAt ?? "");
  const receiptAt = new Date(
    Number.isNaN(t) ? Date.parse(args.eventReceivedAt) : t,
  ).toISOString();

  const id = crypto.randomUUID();
  let sealed: { keyId: string; nonce: string; ciphertext: string } | null =
    null;
  if (args.captureEnabled && args.ring) {
    try {
      sealed = await seal(parsed.token, args.ring, `${id}:utility_receipt`);
    } catch {
      sealed = null; // never fall back to storing plaintext
    }
  }

  const stored = await args.deps.storeReceipt({
    id,
    workspaceId: args.workspaceId,
    format: parsed.format,
    amountRwf: parsed.amountRwf,
    kwhMilli: milli,
    meterLast4: meterLast4(parsed.meter),
    vendorRefHash: await vendorRefHash(parsed),
    receiptAt,
    tokenKeyId: sealed?.keyId ?? null,
    tokenNonce: sealed?.nonce ?? null,
    tokenCiphertext: sealed?.ciphertext ?? null,
  });
  if (!stored.ok) {
    // Nothing was written; the event stays pending and is retried (bounded).
    return args.attempts + 1 >= 5 ? "failed" : "retried";
  }

  await args.deps.finalize({
    parseStatus: stored.created ? "normalized" : "superseded",
    rawMessage: redactUtilityToken(args.rawMessage),
  });
  return stored.created ? "processed" : "superseded";
}
