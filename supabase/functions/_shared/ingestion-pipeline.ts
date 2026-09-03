// The parse → normalized `transactions` row pipeline for an inbound financial
// message, factored as pure dependency-injected logic (like
// ingest-momo/connection-resolver.ts) so it can be unit-tested with fakes and
// reused by more than one caller.
//
// Callers so far: supabase/functions/process-raw-events (the capture channel).
// ingest-momo/index.ts still runs its own inline copy of this logic; migrating
// it onto this module is a separate PR once this is proven on the capture
// channel (docs/ingestion-pipeline.md).
//
// This module NEVER decides routing or authorization - `route` is resolved and
// re-verified by the caller from trusted server state. It NEVER creates a
// second transaction row, and it NEVER auto-merges a duplicate.

import type {
  ParsedTransaction,
  PolicyClassification,
} from "../ingest-momo/types.ts";
import { parseMomoMessage } from "../ingest-momo/parser.ts";
import { computeAccountingEffect } from "./accounting.ts";
import type { AccountingEffect } from "./types.ts";
import {
  deriveDedupeState,
  fingerprintArgs,
} from "../ingest-momo/raw-event.ts";

export const PIPELINE_PARSER_VERSION = "momo-parser-v1.1";

export type PipelineRoute = {
  workspaceId: string;
  accountId: string;
  ingestionConnectionId: string;
  financialSourceId: string | null;
  sourceMaskedIdentifier: string | null;
};

export type PipelineInput = {
  rawMessage: string;
  /** ISO-8601 device receipt time, or null. */
  deviceReceivedAt: string | null;
  /** Detected provider, e.g. `mtn_momo`. Only `mtn_momo` is parsed today. */
  providerKey: string;
};

export type PipelineRefs = {
  /** The synthesized/existing momo_messages row this normalization is attributed to. */
  momoMessageId: string;
  /** The raw_financial_events evidence row, for provenance finalization. */
  rawFinancialEventId: string;
};

export type ActiveAccount = {
  id: string;
  workspace_id: string;
  is_active: boolean;
  archived_at: string | null;
  financial_source_id: string | null;
  source_masked_identifier: string | null;
};

export type TransactionInsertRow = {
  momo_message_id: string;
  account_id: string;
  workspace_id: string;
  ingestion_connection_id: string;
  financial_source_id: string | null;
  dedupe_fingerprint: string | null;
  dedupe_state: "unique" | "possible_duplicate";
  external_transaction_id: string | null;
  source: "mtn_momo";
  transaction_type: ParsedTransaction["transaction_type"];
  direction: ParsedTransaction["direction"];
  status: ParsedTransaction["status"];
  currency: "RWF";
  amount_rwf: number;
  fee_rwf: number;
  balance_after_rwf: number | null;
  counterparty_name: string | null;
  counterparty_reference: string | null;
  occurred_at: string;
  category: string | null;
  subcategory: string | null;
  category_source: string | null;
  category_confidence: number | null;
  category_decision_status: string;
  suggested_category: string | null;
  suggested_subcategory: string | null;
  parser_version: string;
  metadata: Record<string, unknown>;
  principal_effect_rwf: number | null;
  fee_effect_rwf: number | null;
  settlement_state: string | null;
  affects_balance: boolean | null;
  effect_reason: string | null;
};

export type ProcessingErrorInput = {
  stage: "parsing" | "database";
  errorCode: string;
  errorMessage: string;
  details: Record<string, unknown>;
};

export type PipelineDeps = {
  /** Live re-check of the routed account (never trust a stale route). */
  findActiveAccount: (accountId: string) => Promise<ActiveAccount | null>;
  /** Exact MTN transaction-id dedupe, scoped to the workspace. */
  findTransactionByExternalId: (
    externalId: string,
    workspaceId: string,
  ) => Promise<{ id: string } | null>;
  classify: (input: {
    workspaceId: string;
    direction: ParsedTransaction["direction"];
    amountRwf: number;
    counterpartyName: string | null;
    occurredAt: string;
    financialSourceId: string | null;
  }) => Promise<PolicyClassification>;
  /** `compute_transaction_fingerprint` RPC; null on any failure. */
  computeFingerprint: (
    args: ReturnType<typeof fingerprintArgs>,
  ) => Promise<string | null>;
  /** `transaction_duplicate_candidates` count; -1 signals "lookup failed". */
  countDuplicateCandidates: (fingerprint: string) => Promise<number>;
  insertTransaction: (
    row: TransactionInsertRow,
  ) => Promise<
    { ok: true; id: string } | { ok: false; message: string | null }
  >;
  finalizeRawEvent: (
    rawEventId: string,
    patch: {
      parseStatus: "normalized" | "rejected" | "superseded";
      canonicalTransactionId?: string | null;
      financialSourceId?: string | null;
    },
  ) => Promise<void>;
  markMomoMessage: (
    id: string,
    status: "processed" | "needs_review" | "failed",
  ) => Promise<void>;
  insertProcessingError: (
    momoMessageId: string,
    error: ProcessingErrorInput,
  ) => Promise<void>;
  insertCategoryHistory: (args: {
    transactionId: string;
    workspaceId: string;
    classification: PolicyClassification;
  }) => Promise<void>;
  reconcilePaymentIntents?: (transactionId: string) => Promise<void>;
  sweepBudgetThresholds: (workspaceId: string) => Promise<void>;
  touchConnection: (connectionId: string) => Promise<void>;
};

export type PipelineResult =
  | { status: "processed"; transactionId: string }
  | { status: "needs_review" }
  | { status: "duplicate_transaction"; transactionId: string }
  | { status: "account_unavailable" }
  | { status: "accounting_failed" }
  | { status: "db_error" };

async function bestEffort(
  label: string,
  fn: () => Promise<void>,
): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.error(JSON.stringify({
      event: "pipeline_best_effort_failed",
      step: label,
      message: err instanceof Error ? err.message.slice(0, 120) : "unknown",
    }));
  }
}

/**
 * Mirrors ingest-momo/index.ts's post-evidence normalization (parse → MTN
 * txn-id dedupe → accounting → live account re-check → policy eval →
 * fingerprint dedupe → transactions insert → finalize evidence → category
 * history → mark processed → opt-in reconciliation → budget sweep → touch
 * connection). Best-effort steps never change the returned status.
 */
export async function normalizeInboundMessage(
  input: PipelineInput,
  route: PipelineRoute,
  refs: PipelineRefs,
  deps: PipelineDeps,
): Promise<PipelineResult> {
  // --- parse ---------------------------------------------------------------
  const parsed: ParsedTransaction | null = input.providerKey === "mtn_momo"
    ? parseMomoMessage(input.rawMessage)
    : null;

  if (!parsed) {
    await deps.markMomoMessage(refs.momoMessageId, "needs_review");
    await bestEffort(
      "finalize_rejected",
      () =>
        deps.finalizeRawEvent(refs.rawFinancialEventId, {
          parseStatus: "rejected",
        }),
    );
    await bestEffort(
      "processing_error",
      () =>
        deps.insertProcessingError(refs.momoMessageId, {
          stage: "parsing",
          errorCode: "UNRECOGNIZED_MOMO_FORMAT",
          errorMessage:
            "The message did not match a known MTN MoMo parser pattern.",
          details: { provider_key: input.providerKey },
        }),
    );
    return { status: "needs_review" };
  }

  // --- exact MTN transaction-id dedupe ----------------------------------
  if (parsed.external_transaction_id) {
    let existing: { id: string } | null;
    try {
      existing = await deps.findTransactionByExternalId(
        parsed.external_transaction_id,
        route.workspaceId,
      );
    } catch {
      return { status: "db_error" };
    }
    if (existing) {
      await bestEffort(
        "mark_processed_dup",
        () => deps.markMomoMessage(refs.momoMessageId, "processed"),
      );
      await bestEffort(
        "finalize_superseded",
        () =>
          deps.finalizeRawEvent(refs.rawFinancialEventId, {
            parseStatus: "superseded",
            canonicalTransactionId: existing!.id,
          }),
      );
      return { status: "duplicate_transaction", transactionId: existing.id };
    }
  }

  // --- accounting effect ------------------------------------------------
  let accounting: AccountingEffect;
  try {
    accounting = computeAccountingEffect({
      direction: parsed.direction,
      status: parsed.status,
      amount_rwf: parsed.amount_rwf,
      fee_rwf: parsed.fee_rwf,
    });
  } catch (err) {
    await deps.markMomoMessage(refs.momoMessageId, "failed");
    await bestEffort(
      "processing_error_acct",
      () =>
        deps.insertProcessingError(refs.momoMessageId, {
          stage: "database",
          errorCode: "ACCOUNTING_COMPUTATION_FAILED",
          errorMessage:
            "The parsed transaction's accounting effect could not be computed.",
          details: {
            message: err instanceof Error ? err.message : String(err),
          },
        }),
    );
    return { status: "accounting_failed" };
  }

  // --- live account re-check -------------------------------------------
  let account: ActiveAccount | null;
  try {
    account = await deps.findActiveAccount(route.accountId);
  } catch {
    return { status: "db_error" };
  }
  if (!account || !account.is_active || account.archived_at) {
    await deps.markMomoMessage(refs.momoMessageId, "failed");
    await bestEffort(
      "processing_error_acct_unavail",
      () =>
        deps.insertProcessingError(refs.momoMessageId, {
          stage: "database",
          errorCode: "ACCOUNT_UNAVAILABLE",
          errorMessage:
            "The routed account is archived or inactive; ingestion was refused rather than silently rerouted.",
          details: { ingestion_connection_id: route.ingestionConnectionId },
        }),
    );
    return { status: "account_unavailable" };
  }

  const resolvedWorkspaceId = account.workspace_id;
  const resolvedFinancialSourceId = account.financial_source_id ?? null;
  const resolvedMaskedIdentifier = account.source_masked_identifier ?? null;

  // --- categorization -------------------------------------------------
  const classification = await deps.classify({
    workspaceId: resolvedWorkspaceId,
    direction: parsed.direction,
    amountRwf: parsed.amount_rwf,
    counterpartyName: parsed.counterparty_name,
    occurredAt: parsed.occurred_at,
    financialSourceId: resolvedFinancialSourceId,
  });

  // --- transaction-level fingerprint dedupe (advisory only) ---------
  let dedupeFingerprint: string | null = null;
  let dedupeState: "unique" | "possible_duplicate" = "unique";
  await bestEffort("fingerprint", async () => {
    const fp = await deps.computeFingerprint(
      fingerprintArgs(parsed, { maskedIdentifier: resolvedMaskedIdentifier }),
    );
    if (fp) {
      dedupeFingerprint = fp;
      const count = await deps.countDuplicateCandidates(fp);
      dedupeState = deriveDedupeState(count > 0 ? count : 0);
    }
  });

  // --- ledger insert ------------------------------------------------
  const row: TransactionInsertRow = {
    momo_message_id: refs.momoMessageId,
    account_id: account.id,
    workspace_id: resolvedWorkspaceId,
    ingestion_connection_id: route.ingestionConnectionId,
    financial_source_id: resolvedFinancialSourceId,
    dedupe_fingerprint: dedupeFingerprint,
    dedupe_state: dedupeState,
    external_transaction_id: parsed.external_transaction_id,
    source: "mtn_momo",
    transaction_type: parsed.transaction_type,
    direction: parsed.direction,
    status: parsed.status,
    currency: "RWF",
    amount_rwf: parsed.amount_rwf,
    fee_rwf: parsed.fee_rwf,
    balance_after_rwf: parsed.balance_after_rwf,
    counterparty_name: classification.normalizedMerchantName ??
      parsed.counterparty_name,
    counterparty_reference: parsed.counterparty_reference,
    occurred_at: parsed.occurred_at,
    category: classification.category,
    subcategory: classification.subcategory,
    category_source: classification.categorySource,
    category_confidence: classification.categoryConfidence,
    category_decision_status: classification.decisionStatus,
    suggested_category: classification.suggestedCategory,
    suggested_subcategory: classification.suggestedSubcategory,
    parser_version: PIPELINE_PARSER_VERSION,
    metadata: {
      ...parsed.metadata,
      original_counterparty_name: parsed.counterparty_name,
      policy_applied: classification.categorySource === "rule",
      ingestion_origin: "iphone_capture_v2",
    },
    principal_effect_rwf: accounting.principal_effect_rwf,
    fee_effect_rwf: accounting.fee_effect_rwf,
    settlement_state: accounting.settlement_state,
    affects_balance: accounting.affects_balance,
    effect_reason: accounting.effect_reason,
  };

  const inserted = await deps.insertTransaction(row);
  if (!inserted.ok) {
    await deps.markMomoMessage(refs.momoMessageId, "failed");
    await bestEffort(
      "processing_error_insert",
      () =>
        deps.insertProcessingError(refs.momoMessageId, {
          stage: "database",
          errorCode: "TRANSACTION_INSERT_FAILED",
          errorMessage:
            "The parsed transaction could not be saved to the ledger.",
          details: { postgres_message: inserted.message ?? null },
        }),
    );
    return { status: "db_error" };
  }

  // --- best-effort finalization -----------------------------------
  await bestEffort(
    "finalize_normalized",
    () =>
      deps.finalizeRawEvent(refs.rawFinancialEventId, {
        parseStatus: "normalized",
        canonicalTransactionId: inserted.id,
        financialSourceId: resolvedFinancialSourceId,
      }),
  );
  await bestEffort("category_history", () =>
    deps.insertCategoryHistory({
      transactionId: inserted.id,
      workspaceId: resolvedWorkspaceId,
      classification,
    }));
  await bestEffort(
    "mark_processed",
    () => deps.markMomoMessage(refs.momoMessageId, "processed"),
  );
  if (deps.reconcilePaymentIntents) {
    await bestEffort(
      "reconcile",
      () => deps.reconcilePaymentIntents!(inserted.id),
    );
  }
  await bestEffort(
    "budget_sweep",
    () => deps.sweepBudgetThresholds(resolvedWorkspaceId),
  );
  await bestEffort(
    "touch_connection",
    () => deps.touchConnection(route.ingestionConnectionId),
  );

  return { status: "processed", transactionId: inserted.id };
}
