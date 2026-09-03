import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  normalizeInboundMessage,
  type PipelineDeps,
  type PipelineResult,
  type TransactionInsertRow,
} from "../ingestion-pipeline.ts";
import type { PolicyClassification } from "../../ingest-momo/types.ts";

const MERCHANT_SMS =
  "TxId:29946098339*S*Your payment of 4,000 RWF to KMLVIO CENTER AND MILK ZONE SHOP 093011 was completed at 2026-08-18 11:02:56. Balance: 3,675 RWF. Fee 0 RWF.*EN#";
const RECEIVED_SMS =
  "You have received 7500 RWF from Ogabor JULIUS INEJI (*********901) at 2026-08-18 10:37:10 . Balance:7675 RWF. FT Id: 29945559123";
const UNPARSEABLE_RWF =
  "You have topped up your account with 5000 RWF. Ref: ABC123";

const ROUTE = {
  workspaceId: "ws-1",
  accountId: "acc-1",
  ingestionConnectionId: "conn-1",
  financialSourceId: "fs-1",
  sourceMaskedIdentifier: "•••• 3456",
};
const REFS = { momoMessageId: "mm-1", rawFinancialEventId: "rfe-1" };
const INPUT = {
  rawMessage: MERCHANT_SMS,
  deviceReceivedAt: "2026-08-18T11:03:00+02:00",
  providerKey: "mtn_momo",
};

const EMPTY_CLASS: PolicyClassification = {
  normalizedMerchantName: null,
  category: null,
  subcategory: null,
  categorySource: null,
  categoryConfidence: null,
  suggestedCategory: null,
  suggestedSubcategory: null,
  decisionStatus: "uncategorized",
  matchedPolicyId: null,
  explanation: null,
};

function fakeDeps(over: Partial<PipelineDeps> = {}) {
  const calls = {
    markMomoMessage: [] as Array<[string, string]>,
    finalizeRawEvent: [] as Array<Record<string, unknown>>,
    processingErrors: [] as string[],
    categoryHistory: 0,
    sweep: 0,
    touch: 0,
    reconcile: 0,
    inserted: null as TransactionInsertRow | null,
  };
  const deps: PipelineDeps = {
    findActiveAccount: () =>
      Promise.resolve({
        id: "acc-1",
        workspace_id: "ws-1",
        is_active: true,
        archived_at: null,
        financial_source_id: "fs-1",
        source_masked_identifier: "•••• 3456",
      }),
    findTransactionByExternalId: () => Promise.resolve(null),
    classify: () => Promise.resolve(EMPTY_CLASS),
    computeFingerprint: () => Promise.resolve("fp-abc"),
    countDuplicateCandidates: () => Promise.resolve(0),
    insertTransaction: (row) => {
      calls.inserted = row;
      return Promise.resolve({ ok: true, id: "txn-1" });
    },
    finalizeRawEvent: (_id, patch) => {
      calls.finalizeRawEvent.push(patch as Record<string, unknown>);
      return Promise.resolve();
    },
    markMomoMessage: (id, status) => {
      calls.markMomoMessage.push([id, status]);
      return Promise.resolve();
    },
    insertProcessingError: (_id, e) => {
      calls.processingErrors.push(e.errorCode);
      return Promise.resolve();
    },
    insertCategoryHistory: () => {
      calls.categoryHistory++;
      return Promise.resolve();
    },
    reconcilePaymentIntents: () => {
      calls.reconcile++;
      return Promise.resolve();
    },
    sweepBudgetThresholds: () => {
      calls.sweep++;
      return Promise.resolve();
    },
    touchConnection: () => {
      calls.touch++;
      return Promise.resolve();
    },
    ...over,
  };
  return { deps, calls };
}

Deno.test("pipeline: parseable merchant payment → processed, correct ledger row + best-effort steps", async () => {
  const { deps, calls } = fakeDeps();
  const res: PipelineResult = await normalizeInboundMessage(
    INPUT,
    ROUTE,
    REFS,
    deps,
  );
  assertEquals(res, { status: "processed", transactionId: "txn-1" });
  const row = calls.inserted!;
  assertEquals(row.source, "mtn_momo");
  assertEquals(row.direction, "out");
  assertEquals(row.amount_rwf, 4000);
  assertEquals(row.fee_rwf, 0);
  assertEquals(row.momo_message_id, "mm-1");
  assertEquals(row.external_transaction_id, "29946098339");
  assert(row.principal_effect_rwf !== null && row.principal_effect_rwf < 0);
  assertEquals(row.dedupe_state, "unique");
  assertEquals(row.dedupe_fingerprint, "fp-abc");
  assertEquals(
    calls.finalizeRawEvent.at(-1),
    {
      parseStatus: "normalized",
      canonicalTransactionId: "txn-1",
      financialSourceId: "fs-1",
    },
  );
  assertEquals(calls.markMomoMessage.at(-1), ["mm-1", "processed"]);
  assertEquals([
    calls.categoryHistory,
    calls.sweep,
    calls.touch,
    calls.reconcile,
  ], [1, 1, 1, 1]);
});

Deno.test("pipeline: an incoming message computes a positive principal effect", async () => {
  const { deps, calls } = fakeDeps();
  await normalizeInboundMessage(
    { ...INPUT, rawMessage: RECEIVED_SMS },
    ROUTE,
    REFS,
    deps,
  );
  assertEquals(calls.inserted!.direction, "in");
  assert(calls.inserted!.principal_effect_rwf! > 0);
});

Deno.test("pipeline: RWF-but-unparseable → needs_review, momo_message needs_review, evidence rejected, processing_error", async () => {
  const { deps, calls } = fakeDeps();
  const res = await normalizeInboundMessage(
    { ...INPUT, rawMessage: UNPARSEABLE_RWF },
    ROUTE,
    REFS,
    deps,
  );
  assertEquals(res, { status: "needs_review" });
  assertEquals(calls.markMomoMessage, [["mm-1", "needs_review"]]);
  assertEquals(calls.finalizeRawEvent, [{ parseStatus: "rejected" }]);
  assertEquals(calls.processingErrors, ["UNRECOGNIZED_MOMO_FORMAT"]);
  assertEquals(calls.inserted, null);
});

Deno.test("pipeline: non-mtn provider is not parsed → needs_review", async () => {
  const { deps } = fakeDeps();
  const res = await normalizeInboundMessage(
    { ...INPUT, providerKey: "airtel_money" },
    ROUTE,
    REFS,
    deps,
  );
  assertEquals(res.status, "needs_review");
});

Deno.test("pipeline: known external_transaction_id → duplicate_transaction, evidence superseded, no insert", async () => {
  const { deps, calls } = fakeDeps({
    findTransactionByExternalId: () => Promise.resolve({ id: "txn-existing" }),
  });
  const res = await normalizeInboundMessage(INPUT, ROUTE, REFS, deps);
  assertEquals(res, {
    status: "duplicate_transaction",
    transactionId: "txn-existing",
  });
  assertEquals(calls.finalizeRawEvent, [{
    parseStatus: "superseded",
    canonicalTransactionId: "txn-existing",
  }]);
  assertEquals(calls.inserted, null);
});

Deno.test("pipeline: archived account → account_unavailable, momo_message failed, no insert", async () => {
  const { deps, calls } = fakeDeps({
    findActiveAccount: () =>
      Promise.resolve({
        id: "acc-1",
        workspace_id: "ws-1",
        is_active: false,
        archived_at: "2026-01-01T00:00:00Z",
        financial_source_id: "fs-1",
        source_masked_identifier: null,
      }),
  });
  const res = await normalizeInboundMessage(INPUT, ROUTE, REFS, deps);
  assertEquals(res, { status: "account_unavailable" });
  assertEquals(calls.markMomoMessage, [["mm-1", "failed"]]);
  assertEquals(calls.processingErrors, ["ACCOUNT_UNAVAILABLE"]);
  assertEquals(calls.inserted, null);
});

Deno.test("pipeline: every parseable fixture computes an accounting effect without the accounting_failed branch", async () => {
  // computeAccountingEffect only throws on inputs the parser cannot produce
  // (negative / non-integer amounts) - the branch is defence-in-depth. Real
  // parser output must always pass it.
  for (const sms of [MERCHANT_SMS, RECEIVED_SMS]) {
    const { deps } = fakeDeps();
    const res = await normalizeInboundMessage(
      { ...INPUT, rawMessage: sms },
      ROUTE,
      REFS,
      deps,
    );
    assert(
      res.status !== "accounting_failed",
      `${sms.slice(0, 30)} → ${res.status}`,
    );
  }
});

Deno.test("pipeline: transaction insert error → db_error, momo_message failed, processing_error", async () => {
  const { deps, calls } = fakeDeps({
    insertTransaction: () =>
      Promise.resolve({ ok: false, message: "duplicate key" }),
  });
  const res = await normalizeInboundMessage(INPUT, ROUTE, REFS, deps);
  assertEquals(res, { status: "db_error" });
  assertEquals(calls.markMomoMessage, [["mm-1", "failed"]]);
  assertEquals(calls.processingErrors, ["TRANSACTION_INSERT_FAILED"]);
});

Deno.test("pipeline: fingerprint candidates > 0 → row stamped possible_duplicate, still processed", async () => {
  const { deps, calls } = fakeDeps({
    countDuplicateCandidates: () => Promise.resolve(2),
  });
  const res = await normalizeInboundMessage(INPUT, ROUTE, REFS, deps);
  assertEquals(res.status, "processed");
  assertEquals(calls.inserted!.dedupe_state, "possible_duplicate");
});

Deno.test("pipeline: a throwing best-effort dep does not fail the ingestion", async () => {
  const { deps } = fakeDeps({
    sweepBudgetThresholds: () => Promise.reject(new Error("boom")),
    touchConnection: () => Promise.reject(new Error("boom")),
    insertCategoryHistory: () => Promise.reject(new Error("boom")),
    finalizeRawEvent: () => Promise.reject(new Error("boom")),
  });
  const res = await normalizeInboundMessage(INPUT, ROUTE, REFS, deps);
  assertEquals(res, { status: "processed", transactionId: "txn-1" });
});

Deno.test("pipeline: a failing fingerprint lookup leaves the row unique", async () => {
  const { deps, calls } = fakeDeps({
    computeFingerprint: () => Promise.reject(new Error("rpc down")),
  });
  const res = await normalizeInboundMessage(INPUT, ROUTE, REFS, deps);
  assertEquals(res.status, "processed");
  assertEquals(calls.inserted!.dedupe_state, "unique");
  assertEquals(calls.inserted!.dedupe_fingerprint, null);
});
