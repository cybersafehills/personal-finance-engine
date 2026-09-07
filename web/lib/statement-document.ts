// Shared rendering model + CSV writer for a generated statement
// (Financial Documents Engine, Statements family - PR4). Zero DB access;
// both the CSV writer here and lib/statement-pdf.tsx read ONLY from a
// StatementDocData assembled by the download route from the persisted
// snapshot (statements + statement_transactions) - never a fresh query,
// never a recomputation (master prompt section 17).
//
// Deno-testable. csv-safe.ts (pure) provides the RFC-4180 + formula-
// injection defence, unchanged from the integrations exporter.

import type { StatementCurrencyTotals } from "./statement-math.ts";
import type { StatementCoverageMetadata } from "./statement-coverage.ts";
import type { StatementSourceMetadata } from "./statement-coverage.ts";
import { csvDocument } from "./integrations/export/csv-safe.ts";

export type StatementDocLine = {
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

export type StatementDocData = {
  statementId: string;
  statementType: "standard" | "detailed";
  scope: "single_account" | "all_accounts" | "filtered";
  accountHolderName: string | null;
  periodLabel: string;
  periodStartIso: string;
  periodEndIso: string;
  timezone: string;
  currency: string;
  generatedAtIso: string;
  openingBalanceMinor: number | null;
  closingBalanceMinor: number | null;
  totalCreditsMinor: number;
  totalDebitsMinor: number;
  totalFeesMinor: number;
  netMovementMinor: number;
  transactionCount: number;
  reconciles: boolean | null;
  /** Non-null only for a mixed-currency consolidated statement. */
  perCurrency: StatementCurrencyTotals[] | null;
  runningBalanceAvailable: boolean;
  source: StatementSourceMetadata;
  coverage: StatementCoverageMetadata;
  lines: StatementDocLine[];
};

const MINOR_PER_MAJOR: Record<string, number> = { RWF: 1 };

function minorPerMajor(currency: string): number {
  return MINOR_PER_MAJOR[currency] ?? 100;
}

/** "1,234 RWF" / "12.50 USD" - unsigned magnitude for a Money In / Money Out / balance cell. */
export function formatStatementAmount(minor: number, currency: string): string {
  const per = minorPerMajor(currency);
  const value = Math.abs(minor) / per;
  const digits = per === 1 ? 0 : 2;
  const formatted = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
  return `${formatted} ${currency}`;
}

/** Same, but with a leading minus for a negative value (net movement). */
export function formatStatementSignedAmount(
  minor: number,
  currency: string,
): string {
  const sign = minor < 0 ? "-" : "";
  return `${sign}${formatStatementAmount(minor, currency)}`;
}

/** The local calendar date ("YYYY-MM-DD") an instant falls on in the statement's timezone. */
export function statementDateKey(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function moneyInMinor(line: StatementDocLine): number | "" {
  return line.direction === "in" ? Math.abs(line.principalEffectMinor) : "";
}

function moneyOutMinor(line: StatementDocLine): number | "" {
  return line.direction === "out" ? Math.abs(line.principalEffectMinor) : "";
}

const STANDARD_HEADER = [
  "Date",
  "Description",
  "Reference",
  "Money In",
  "Money Out",
  "Fees",
  "Balance",
];

const DETAILED_HEADER = [
  "Date",
  "Description",
  "Original Description",
  "Reference",
  "Category",
  "Direction",
  "Money In",
  "Money Out",
  "Fees",
  "Balance",
  "Currency",
];

/**
 * A machine-readable CSV of the statement's lines. Amounts are integer
 * minor units (RWF whole numbers), never formatted with separators or a
 * currency symbol - stable columns, documented semantics (master prompt
 * section 22). Every text cell passes through csv-safe.ts's formula-
 * injection defence. Prefixed with a UTF-8 BOM so Excel reads accented
 * counterparty names correctly.
 */
export function buildStatementCsv(data: StatementDocData): string {
  const isDetailed = data.statementType === "detailed";
  const header = isDetailed ? DETAILED_HEADER : STANDARD_HEADER;

  const rows = data.lines.map((line) => {
    const date = statementDateKey(line.occurredAt, data.timezone);
    const fees = Math.abs(line.feeEffectMinor);
    const balance = line.runningBalanceMinor ?? "";
    if (isDetailed) {
      return [
        date,
        line.displayDescription,
        line.originalDescription ?? "",
        line.reference ?? "",
        line.category ?? "",
        line.direction,
        moneyInMinor(line),
        moneyOutMinor(line),
        fees,
        balance,
        data.currency,
      ];
    }
    return [
      date,
      line.displayDescription,
      line.reference ?? "",
      moneyInMinor(line),
      moneyOutMinor(line),
      fees,
      balance,
    ];
  });

  return `﻿${csvDocument(header, rows)}`;
}
