// Pure helpers for assembling a statement snapshot (Financial Documents
// Engine, Statements family - PR3). No DB access, no `server-only` import,
// so this is `deno test`-able; lib/statement-generation.ts (server-only)
// does the querying and calls these to shape rows.
//
// Only the PR2 pure modules are imported (themselves zero-import), so the
// deno test type-checker can resolve the whole graph.

import type {
  StatementCurrencyTotals,
  StatementMathResult,
  StatementTransactionFact,
} from "./statement-math.ts";
import type { StatementCoverageFact } from "./statement-coverage.ts";

/** A single statement may not exceed this many transactions (master prompt sections 35 / 55). */
export const MAX_STATEMENT_TRANSACTIONS = 50_000;

export type StatementType = "standard" | "detailed";
export type StatementScope = "single_account" | "all_accounts" | "filtered";
export type StatementDirectionFilter = "in" | "out";
export type StatementFilters = { direction?: StatementDirectionFilter };

/** The transactions columns lib/statement-generation.ts selects for a statement. */
export type LedgerTxnRow = {
  id: string;
  occurred_at: string;
  transaction_type: string;
  direction: "in" | "out" | "neutral";
  principal_effect_rwf: number | string | null;
  fee_effect_rwf: number | string | null;
  balance_after_rwf: number | string | null;
  currency: string;
  counterparty_name: string | null;
  counterparty_reference: string | null;
  category: string | null;
  financial_source_id: string | null;
};

const TYPE_LABELS: Record<string, string> = {
  send_money: "Money sent",
  merchant_payment: "Merchant payment",
  money_received: "Money received",
  airtime: "Airtime purchase",
  cash_withdrawal: "Cash withdrawal",
  cash_deposit: "Cash deposit",
  bill_payment: "Bill payment",
  bank_transfer: "Bank transfer",
  refund: "Refund",
  reversal: "Reversal",
  other: "Transaction",
};

export function humanizeTransactionType(type: string): string {
  return TYPE_LABELS[type] ?? "Transaction";
}

function toMinor(value: number | string | null): number {
  if (value === null) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function toMathFact(row: LedgerTxnRow): StatementTransactionFact {
  return {
    id: row.id,
    occurredAt: row.occurred_at,
    direction: row.direction,
    principalEffectMinor: toMinor(row.principal_effect_rwf),
    feeEffectMinor: toMinor(row.fee_effect_rwf),
    balanceAfterMinor: row.balance_after_rwf === null
      ? null
      : toMinor(row.balance_after_rwf),
    currency: row.currency,
  };
}

export function toCoverageFact(row: LedgerTxnRow): StatementCoverageFact {
  return {
    occurredAt: row.occurred_at,
    principalEffectMinor: toMinor(row.principal_effect_rwf),
    feeEffectMinor: toMinor(row.fee_effect_rwf),
    balanceAfterMinor: row.balance_after_rwf === null
      ? null
      : toMinor(row.balance_after_rwf),
  };
}

export type StatementDisplayFields = {
  displayDescription: string;
  /** The verbatim provider string, kept only when it differs from the display description (master prompt section 10). */
  originalDescription: string | null;
  reference: string | null;
  category: string | null;
};

/**
 * The friendly description, the verbatim provider reference, and (detailed
 * type only) the category, from one ledger row. `counterparty_name` is
 * OneLedger's normalized label; `counterparty_reference` is the provider's
 * own string. A statement shows the friendly label but never drops the
 * original (master prompt section 10) - this schema has no dedicated raw
 * description column yet, so the provider reference is the closest verbatim
 * value we carry; statements.original_description exists for when
 * ingestion starts persisting a dedicated one.
 */
export function toDisplayFields(
  row: LedgerTxnRow,
  statementType: StatementType,
): StatementDisplayFields {
  const name = row.counterparty_name?.trim();
  const displayDescription = name && name.length > 0
    ? name
    : humanizeTransactionType(row.transaction_type);
  const reference = row.counterparty_reference?.trim() || null;
  const originalDescription = reference && reference !== displayDescription
    ? reference
    : null;
  return {
    displayDescription,
    originalDescription,
    reference,
    category: statementType === "detailed" ? (row.category ?? null) : null,
  };
}

// ---------------------------------------------------------------------------
// Scope + source authorization
// ---------------------------------------------------------------------------

export type ScopeResolution =
  | { ok: true; scope: StatementScope; sourceIds: string[] }
  | { ok: false; kind: "unauthorized_source" };

/**
 * Turn a client's requested source ids into the concrete scope + source
 * list, or reject. `authorizedIds` is the set the caller may generate a
 * statement for in the active workspace (resolved server-side from
 * ownership / source_space_links).
 *
 * An EXPLICIT request must be a subset of the authorized set; anything
 * outside it is rejected generically - no signal about whether it exists
 * (master prompt section 33). An EMPTY request means "everything in this
 * workspace the caller can see": it resolves to `all_accounts` with the
 * authorized ids (possibly none - the fact query is then simply
 * unrestricted and RLS is the boundary; a workspace with only legacy
 * source-less transactions still works).
 */
export function resolveStatementScope(
  requestedIds: string[],
  authorizedIds: string[],
  filters: StatementFilters | undefined,
): ScopeResolution {
  const authorized = new Set(authorizedIds);
  const requested = Array.from(new Set(requestedIds.filter((id) => id)));

  let sourceIds: string[];
  if (requested.length === 0) {
    sourceIds = Array.from(authorized);
  } else {
    if (!requested.every((id) => authorized.has(id))) {
      return { ok: false, kind: "unauthorized_source" };
    }
    sourceIds = requested;
  }

  const scope: StatementScope = filters?.direction
    ? "filtered"
    : sourceIds.length === 1
    ? "single_account"
    : "all_accounts";

  return { ok: true, scope, sourceIds };
}

// ---------------------------------------------------------------------------
// Insert-row shaping
// ---------------------------------------------------------------------------

export type StatementTransactionInsert = {
  statement_id: string;
  transaction_id: string;
  occurred_at: string;
  display_description: string;
  original_description: string | null;
  reference: string | null;
  direction: "in" | "out" | "neutral";
  principal_effect_minor: number;
  fee_effect_minor: number;
  running_balance_minor: number | null;
  category: string | null;
  sort_index: number;
};

/**
 * One statement_transactions insert per math row (already chronological),
 * pairing the computed running balance with the frozen display fields.
 * `statementUuid` is statements.id, not the public OL-ST- id.
 */
export function buildStatementTransactionRows(
  math: StatementMathResult,
  rowsById: Map<string, LedgerTxnRow>,
  opts: { statementUuid: string; statementType: StatementType },
): StatementTransactionInsert[] {
  return math.rows.map((mathRow, index) => {
    const row = rowsById.get(mathRow.factId);
    if (!row) {
      throw new Error(
        `buildStatementTransactionRows: no ledger row for ${mathRow.factId}`,
      );
    }
    const display = toDisplayFields(row, opts.statementType);
    return {
      statement_id: opts.statementUuid,
      transaction_id: row.id,
      occurred_at: row.occurred_at,
      display_description: display.displayDescription,
      original_description: display.originalDescription,
      reference: display.reference,
      direction: row.direction,
      principal_effect_minor: toMinor(row.principal_effect_rwf),
      fee_effect_minor: toMinor(row.fee_effect_rwf),
      running_balance_minor: mathRow.runningBalanceMinor,
      category: display.category,
      sort_index: index,
    };
  });
}

export type StatementRecordInput = {
  statementPublicId: string;
  workspaceId: string;
  createdBy: string;
  statementType: StatementType;
  scope: StatementScope;
  accountIds: string[];
  filters: StatementFilters;
  periodStartUtc: Date;
  periodEndUtc: Date;
  timezone: string;
  currencyHint: string;
  math: StatementMathResult;
  sourceMetadata: unknown;
  coverageMetadata: unknown;
  supersedesId: string | null;
  clientToken: string;
  now: Date;
};

export type StatementRecord = {
  statement_id: string;
  workspace_id: string;
  created_by: string;
  statement_type: StatementType;
  scope: StatementScope;
  account_ids: string[];
  filters: StatementFilters;
  period_start: string;
  period_end: string;
  timezone: string;
  currency: string;
  opening_balance_minor: number | null;
  closing_balance_minor: number | null;
  total_credit_minor: number;
  total_debit_minor: number;
  total_fees_minor: number;
  transaction_count: number;
  per_currency: StatementCurrencyTotals[] | null;
  source_metadata: unknown;
  coverage_metadata: unknown;
  reconciles: boolean | null;
  status: "ready";
  supersedes_id: string | null;
  client_token: string;
  generated_at: string;
};

/** The single `statements` row to insert (service role). */
export function buildStatementRecord(
  input: StatementRecordInput,
): StatementRecord {
  const t = input.math.totals;
  return {
    statement_id: input.statementPublicId,
    workspace_id: input.workspaceId,
    created_by: input.createdBy,
    statement_type: input.statementType,
    scope: input.scope,
    account_ids: input.accountIds,
    filters: input.filters,
    period_start: input.periodStartUtc.toISOString(),
    period_end: input.periodEndUtc.toISOString(),
    timezone: input.timezone,
    currency: input.math.currency ?? input.currencyHint ?? "RWF",
    opening_balance_minor: t?.openingBalanceMinor ?? null,
    closing_balance_minor: t?.closingBalanceMinor ?? null,
    total_credit_minor: t?.totalCreditsMinor ?? 0,
    total_debit_minor: t?.totalDebitsMinor ?? 0,
    total_fees_minor: t?.totalFeesMinor ?? 0,
    transaction_count: input.math.rows.length,
    per_currency: input.math.mixedCurrency ? input.math.perCurrency : null,
    source_metadata: input.sourceMetadata,
    coverage_metadata: input.coverageMetadata,
    reconciles: t?.reconciles ?? null,
    status: "ready",
    supersedes_id: input.supersedesId,
    client_token: input.clientToken,
    generated_at: input.now.toISOString(),
  };
}
