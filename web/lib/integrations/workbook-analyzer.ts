// Multi-sheet workbook analyzer (master prompt §41, gap analysis G4).
// "Connect existing business records": the user uploads a workbook they
// already keep, and OneLedger classifies every sheet — which look like
// transaction tables, how many rows are usable, what it couldn't read —
// so they can pick which sheets to bring in. Each chosen sheet then
// becomes its own import batch and runs the normal Import Studio flow.
//
// Pure (reuses `profileTabularData` + `matchRegisterTemplate`, both
// pure); no IO, no server-only. Detection is deliberately hedged
// (§41: "Do not claim certainty where detection is uncertain") — the
// user confirms every classification before anything is staged.

import { profileTabularData } from "./profile.ts";
import { matchRegisterTemplate } from "./register-templates.ts";

export type SheetKind = "transactions" | "unrecognised" | "empty";
export type SheetConfidence = "high" | "medium" | "low";

export type SheetAnalysis = {
  name: string;
  kind: SheetKind;
  confidence: SheetConfidence;
  /** header row width */
  columnCount: number;
  /** data rows, excluding blank + repeated-header rows */
  dataRowCount: number;
  /** rows that already look ready to become a transaction */
  readyRows: number;
  /** rows missing a readable date or amount */
  invalidRows: number;
  headers: string[];
  dateRange: { start: string; end: string } | null;
  currencyGuess: string | null;
  /** name of a matched OneLedger starter register template, if any */
  matchedTemplate: string | null;
  /** one hedged sentence explaining the classification */
  note: string;
  /** ticked by default in the picker */
  recommended: boolean;
};

export type WorkbookAnalysis = {
  sheetCount: number;
  /** sheets classified `transactions` */
  candidateSheets: number;
  /** sum of `readyRows` across candidate sheets */
  candidateRows: number;
  sheets: SheetAnalysis[];
};

export type RawSheet = { name: string; headers: string[]; rows: string[][] };

/** True for a data row that is neither blank nor a repeated header line. */
function isDataRow(row: string[], normalizedHeaders: string[]): boolean {
  if (row.every((c) => c.trim() === "")) return false;
  if (
    row.length === normalizedHeaders.length &&
    row.every((c, i) => c.trim().toLowerCase() === normalizedHeaders[i])
  ) return false;
  return true;
}

export function analyzeSheet(sheet: RawSheet): SheetAnalysis {
  const { name, headers, rows } = sheet;
  const normalizedHeaders = headers.map((h) => h.trim().toLowerCase());
  const dataRows = rows.filter((r) => isDataRow(r, normalizedHeaders));

  const base = {
    name,
    columnCount: headers.length,
    headers,
    matchedTemplate: null as string | null,
    dateRange: null as { start: string; end: string } | null,
    currencyGuess: null as string | null,
  };

  if (headers.length === 0 || dataRows.length === 0) {
    return {
      ...base,
      kind: "empty",
      confidence: "high",
      dataRowCount: 0,
      readyRows: 0,
      invalidRows: 0,
      note: headers.length === 0
        ? "No header row — nothing to import."
        : "Header row but no data rows.",
      recommended: false,
    };
  }

  const profile = profileTabularData(headers, rows);
  const template = matchRegisterTemplate(headers);
  const readyRatio = profile.readyRows / dataRows.length;

  const common = {
    ...base,
    dataRowCount: dataRows.length,
    readyRows: profile.readyRows,
    invalidRows: profile.invalidRows,
    dateRange: profile.dateRange,
    currencyGuess: profile.currencyGuess,
    matchedTemplate: template ? template.template.name : null,
  };

  if (template) {
    return {
      ...common,
      kind: "transactions",
      confidence: "high",
      note:
        `Matches the OneLedger ${template.template.name} — columns should map automatically.`,
      recommended: profile.readyRows > 0,
    };
  }

  if (profile.probableType === "bank_transactions") {
    if (readyRatio >= 0.7) {
      return {
        ...common,
        kind: "transactions",
        confidence: "high",
        note: `Looks like a transaction table — ${profile.readyRows} of ${dataRows.length} rows are ready.`,
        recommended: true,
      };
    }
    if (profile.readyRows > 0) {
      return {
        ...common,
        kind: "transactions",
        confidence: "medium",
        note:
          `Looks like transactions, but only ${profile.readyRows} of ${dataRows.length} rows read cleanly — check the mapping.`,
        recommended: true,
      };
    }
    return {
      ...common,
      kind: "transactions",
      confidence: "low",
      note:
        "Has date and amount columns, but no row could be read — the column mapping likely needs fixing.",
      recommended: false,
    };
  }

  // probableType === "unknown"
  if (profile.columnGuess.date !== null || profile.columnGuess.amount !== null) {
    return {
      ...common,
      kind: "transactions",
      confidence: "low",
      note:
        "Might be transactions — a date or amount column is missing or wasn’t recognised.",
      recommended: false,
    };
  }

  return {
    ...common,
    kind: "unrecognised",
    confidence: "high",
    note: "No date + amount columns — this doesn’t look like a transaction table.",
    recommended: false,
  };
}

export function analyzeWorkbook(sheets: RawSheet[]): WorkbookAnalysis {
  const analyzed = sheets.map(analyzeSheet);
  const candidates = analyzed.filter((s) => s.kind === "transactions");
  return {
    sheetCount: analyzed.length,
    candidateSheets: candidates.length,
    candidateRows: candidates.reduce((sum, s) => sum + s.readyRows, 0),
    sheets: analyzed,
  };
}

/** Names of the sheets the picker ticks by default. */
export function recommendedSheetNames(analysis: WorkbookAnalysis): string[] {
  return analysis.sheets.filter((s) => s.recommended).map((s) => s.name);
}
