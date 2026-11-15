// The statements payload for the mobile app (GET /api/mobile/statements).
// Pure: reshapes stored statement rows into plain JSON. The app shows the
// stored totals only - it never recomputes a statement's maths. Generation,
// packs, schedules and provider documents stay on the web.

import { reconstructStatementPeriod } from "./statement-period.ts";
import { isSupportedCurrency } from "./money.ts";

export type StatementRowInput = {
  id: string;
  statement_id: string;
  statement_type: string;
  scope: string;
  status: string;
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
  per_currency:
    | {
      currency: string;
      openingBalanceMinor: number | null;
      closingBalanceMinor: number | null;
      totalCreditsMinor: number;
      totalDebitsMinor: number;
      totalFeesMinor: number;
      reconciles: boolean | null;
    }[]
    | null;
  reconciles: boolean | null;
  coverage_metadata: { warnings?: unknown[] } | null;
  supersedes_id: string | null;
  generated_at: string | null;
};

export type MobileStatementTotals = {
  currency: string;
  openingMinor: number | null;
  closingMinor: number | null;
  creditsMinor: number;
  debitsMinor: number;
  feesMinor: number;
  /** false = the stored opening + movement does not reach the closing balance. */
  reconciles: boolean | null;
};

export type MobileStatement = {
  id: string;
  /** The human reference printed on the document, e.g. "OL-ST-…". */
  reference: string;
  periodLabel: string;
  scopeLabel: string;
  typeLabel: string;
  status: "preparing" | "generating" | "ready" | "failed";
  transactionCount: number;
  generatedAt: string | null;
  isUpdatedVersion: boolean;
  warningCount: number;
  /** One entry per currency; more than one for a mixed-currency statement. */
  totals: MobileStatementTotals[];
};

const SCOPE_LABEL: Record<string, string> = {
  single_account: "Single account",
  all_accounts: "Consolidated",
  filtered: "Filtered",
};
const STATUSES = ["preparing", "generating", "ready", "failed"] as const;

function totalsOf(row: StatementRowInput): MobileStatementTotals[] {
  const per = (row.per_currency ?? []).filter((c) =>
    isSupportedCurrency(c.currency)
  );
  if (per.length > 0) {
    return per.map((c) => ({
      currency: c.currency,
      openingMinor: c.openingBalanceMinor,
      closingMinor: c.closingBalanceMinor,
      creditsMinor: c.totalCreditsMinor,
      debitsMinor: c.totalDebitsMinor,
      feesMinor: c.totalFeesMinor,
      reconciles: c.reconciles,
    }));
  }
  if (!isSupportedCurrency(row.currency)) return [];
  return [{
    currency: row.currency,
    openingMinor: row.opening_balance_minor,
    closingMinor: row.closing_balance_minor,
    creditsMinor: row.total_credit_minor,
    debitsMinor: row.total_debit_minor,
    feesMinor: row.total_fees_minor,
    reconciles: row.reconciles,
  }];
}

/** Null for a row the app cannot show faithfully (unknown status or bad dates). */
export function toMobileStatement(
  row: StatementRowInput,
): MobileStatement | null {
  if (!(STATUSES as readonly string[]).includes(row.status)) return null;
  const start = new Date(row.period_start);
  const end = new Date(row.period_end);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;

  let periodLabel: string;
  try {
    periodLabel = reconstructStatementPeriod(start, end, row.timezone).label;
  } catch {
    return null; // an unrecognised timezone: skip rather than show a wrong period
  }

  return {
    id: row.id,
    reference: row.statement_id,
    periodLabel,
    scopeLabel: SCOPE_LABEL[row.scope] ?? "Statement",
    typeLabel: row.statement_type === "detailed" ? "Detailed" : "Standard",
    status: row.status as MobileStatement["status"],
    transactionCount: row.transaction_count,
    generatedAt: row.generated_at,
    isUpdatedVersion: row.supersedes_id !== null,
    warningCount: row.coverage_metadata?.warnings?.length ?? 0,
    totals: totalsOf(row),
  };
}
