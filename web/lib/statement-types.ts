// Request / outcome contracts shared by the server generation module
// (lib/statement-generation.ts), the "use server" actions, and the client
// generate flow. No `server-only`, no DB, only the pure PR2 modules -
// safe to import from a client component.

import type { StatementPeriodPreset } from "./statement-period.ts";
import type {
  StatementCurrencyTotals,
  StatementRunningBalanceBasis,
} from "./statement-math.ts";
import type {
  StatementCoverageMetadata,
  StatementSourceMetadata,
} from "./statement-coverage.ts";
import type {
  StatementFilters,
  StatementScope,
  StatementType,
} from "./statement-snapshot.ts";

export type StatementErrorKind =
  | "not_signed_in"
  | "no_workspace"
  | "forbidden_role"
  | "invalid_input"
  | "invalid_timezone"
  | "invalid_period"
  | "no_sources"
  | "unauthorized_source"
  | "no_transactions"
  | "too_large"
  | "query_failed"
  | "persist_failed"
  | "not_found";

export type StatementRequest = {
  statementType: StatementType;
  preset: StatementPeriodPreset;
  timezone: string;
  fromDateKey?: string;
  toDateKey?: string;
  sourceIds: string[];
  filters?: StatementFilters;
  clientToken: string;
  /** Force queued generation regardless of size (the worker fills it in). */
  async?: boolean;
};

export type StatementPreviewRow = {
  occurredAt: string;
  displayDescription: string;
  originalDescription: string | null;
  reference: string | null;
  direction: "in" | "out" | "neutral";
  principalEffectMinor: number;
  feeEffectMinor: number;
  runningBalanceMinor: number | null;
  category: string | null;
};

export type StatementPreview = {
  statementType: StatementType;
  scope: StatementScope;
  period: {
    label: string;
    startDateKey: string;
    endDateKey: string;
    periodStartIso: string;
    periodEndIso: string;
    timezone: string;
    adjustments: string[];
  };
  currency: string;
  mixedCurrency: boolean;
  totals:
    | {
      openingBalanceMinor: number | null;
      closingBalanceMinor: number | null;
      totalCreditsMinor: number;
      totalDebitsMinor: number;
      totalFeesMinor: number;
      netMovementMinor: number;
      transactionCount: number;
      reconciles: boolean | null;
    }
    | null;
  perCurrency: StatementCurrencyTotals[];
  runningBalanceBasis: StatementRunningBalanceBasis;
  source: StatementSourceMetadata;
  coverage: StatementCoverageMetadata;
  sampleRows: StatementPreviewRow[];
  sampleTruncated: boolean;
};

export type PreviewOutcome =
  | { ok: true; preview: StatementPreview }
  | { ok: false; kind: StatementErrorKind; message: string };

export type GenerateOutcome =
  | { ok: true; id: string; statementId: string; deduped: boolean }
  | { ok: false; kind: StatementErrorKind; message: string };

export type DeleteOutcome =
  | { ok: true }
  | { ok: false; kind: StatementErrorKind; message: string };
