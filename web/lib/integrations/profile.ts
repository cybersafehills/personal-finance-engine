// Pure data profiling for an uploaded import file: given the parsed
// { headers, rows } (from web/lib/csv.ts or web/lib/xlsx-read.ts), infer
// what the file is and how ready it is to map. No IO, no server-only -
// unit-tested directly. Reuses the statement-import heuristics so the
// Import Studio and the older /settings statement flow stay consistent.

import {
  guessMapping,
  parseAmount,
  parseStatementDate,
} from "../statement-import.ts";

export type ProfileColumnGuess = {
  date: number | null;
  description: number | null;
  amount: number | null;
  direction: number | null;
  balance: number | null;
  reference: number | null;
};

export type DataProfile = {
  rowCount: number;
  columnCount: number;
  headers: string[];
  /** ISO 8601 min/max of the parsed date column, when there is one. */
  dateRange: { start: string; end: string } | null;
  currencyGuess: string | null;
  probableType: "bank_transactions" | "unknown";
  columnGuess: ProfileColumnGuess;
  repeatedHeaderRows: number;
  blankRows: number;
  /** Rows missing a parseable date or amount - cannot become a transaction as-is. */
  invalidRows: number;
  /** Rows that look ready to map to a transaction. */
  readyRows: number;
};

const CURRENCY_CODES = [
  "RWF",
  "USD",
  "EUR",
  "GBP",
  "KES",
  "UGX",
  "TZS",
  "NGN",
  "ZAR",
];
const SYMBOL_TO_CODE: Record<string, string> = {
  "$": "USD",
  "€": "EUR",
  "£": "GBP",
};

/** Look for an explicit 3-letter code, then a currency symbol, in headers + a row sample. */
function guessCurrency(headers: string[], rows: string[][]): string | null {
  const haystack: string[] = [...headers];
  for (const row of rows.slice(0, 50)) haystack.push(...row);

  const counts = new Map<string, number>();
  for (const cell of haystack) {
    const upper = cell.toUpperCase();
    for (const code of CURRENCY_CODES) {
      if (new RegExp(`\\b${code}\\b`).test(upper)) {
        counts.set(code, (counts.get(code) ?? 0) + 1);
      }
    }
    for (const [symbol, code] of Object.entries(SYMBOL_TO_CODE)) {
      if (cell.includes(symbol)) counts.set(code, (counts.get(code) ?? 0) + 1);
    }
  }

  let best: string | null = null;
  let bestCount = 0;
  for (const [code, count] of counts) {
    if (count > bestCount) {
      best = code;
      bestCount = count;
    }
  }
  return best;
}

function cellAt(row: string[], index: number | null): string {
  if (index === null || index < 0 || index >= row.length) return "";
  return row[index];
}

/** Header-name match, returning null (not a 0 fallback) when nothing looks right. */
function findHeader(headers: string[], needles: string[]): number | null {
  const i = headers.findIndex((h) => {
    const l = h.toLowerCase();
    return needles.some((n) => l.includes(n));
  });
  return i >= 0 ? i : null;
}

export function profileTabularData(
  headers: string[],
  rows: string[][],
): DataProfile {
  // guessMapping is reused for the fields where its fallbacks are already
  // null (description / reference / direction); date and amount are
  // re-derived here so an absent column reads as null, not column 0.
  const guess = guessMapping(headers);
  const columnGuess: ProfileColumnGuess = {
    date: findHeader(headers, ["date", "posted", "transaction date"]),
    description: guess.counterparty ?? null,
    amount: findHeader(headers, ["amount", "value", "debit", "credit"]),
    direction: guess.directionColumn ?? null,
    balance: findHeader(headers, ["balance"]),
    reference: guess.externalRef ?? null,
  };

  const normalizedHeaders = headers.map((h) => h.trim().toLowerCase());
  let repeatedHeaderRows = 0;
  let blankRows = 0;
  let invalidRows = 0;
  const dates: string[] = [];

  for (const row of rows) {
    if (row.every((c) => c.trim() === "")) {
      blankRows += 1;
      continue;
    }
    if (
      row.length === headers.length &&
      row.every((c, i) => c.trim().toLowerCase() === normalizedHeaders[i])
    ) {
      repeatedHeaderRows += 1;
      continue;
    }

    const parsedDate = parseStatementDate(cellAt(row, columnGuess.date), "dmy");
    const parsedAmount = parseAmount(cellAt(row, columnGuess.amount));
    if (parsedDate) dates.push(parsedDate);
    if (!parsedDate || !parsedAmount) invalidRows += 1;
  }

  const dataRowCount = rows.length - blankRows - repeatedHeaderRows;
  const readyRows = Math.max(0, dataRowCount - invalidRows);

  dates.sort();
  const dateRange = dates.length > 0
    ? { start: dates[0], end: dates[dates.length - 1] }
    : null;

  const probableType: DataProfile["probableType"] =
    columnGuess.date !== null && columnGuess.amount !== null && dates.length > 0
      ? "bank_transactions"
      : "unknown";

  return {
    rowCount: rows.length,
    columnCount: headers.length,
    headers,
    dateRange,
    currencyGuess: guessCurrency(headers, rows),
    probableType,
    columnGuess,
    repeatedHeaderRows,
    blankRows,
    invalidRows,
    readyRows,
  };
}
