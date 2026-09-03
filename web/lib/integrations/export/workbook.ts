import "server-only";

import ExcelJS from "exceljs";
import { csvDocument, neutralizeFormula } from "./csv-safe.ts";
import type { ExportDataset, ExportTransactionRow } from "./query.ts";

// CSV and multi-sheet XLSX builders for an export dataset. Server-only
// (exceljs must not reach the browser bundle). Every string cell is run
// through neutralizeFormula so a crafted description cannot execute in a
// spreadsheet. No internal ids / secrets in the output.

export const EXPORT_SHEETS = [
  "Summary",
  "Transactions",
  "Income",
  "Expenses",
  "Categories",
  "Accounts",
] as const;
export type ExportSheet = (typeof EXPORT_SHEETS)[number];

const TXN_HEADER = [
  "Date",
  "Description",
  "Reference",
  "Transaction ID",
  "Direction",
  "Amount",
  "Currency",
  "Category",
  "Account",
];

function ymd(iso: string): string {
  return iso.slice(0, 10);
}

/** Signed minor units: money out is negative. */
function signedAmount(row: ExportTransactionRow): number {
  return row.direction === "out" ? -row.amountMinor : row.amountMinor;
}

function txnValues(row: ExportTransactionRow): (string | number)[] {
  return [
    ymd(row.occurredAt),
    row.description ?? "",
    row.reference ?? "",
    row.externalId ?? "",
    row.direction,
    signedAmount(row),
    row.currency,
    row.category ?? "",
    row.accountName ?? "",
  ];
}

// --- CSV --------------------------------------------------------------

export function buildCsv(dataset: ExportDataset): string {
  return csvDocument(TXN_HEADER, dataset.transactions.map(txnValues));
}

// --- aggregates ------------------------------------------------------

function summarise(dataset: ExportDataset) {
  const byCurrency = new Map<
    string,
    { count: number; inflow: number; outflow: number }
  >();
  for (const t of dataset.transactions) {
    const c = byCurrency.get(t.currency) ?? { count: 0, inflow: 0, outflow: 0 };
    c.count += 1;
    if (t.direction === "in") c.inflow += t.amountMinor;
    else if (t.direction === "out") c.outflow += t.amountMinor;
    byCurrency.set(t.currency, c);
  }
  return byCurrency;
}

function byCategory(dataset: ExportDataset) {
  const map = new Map<string, { count: number; net: number }>();
  for (const t of dataset.transactions) {
    const key = t.category ?? "(uncategorised)";
    const c = map.get(key) ?? { count: 0, net: 0 };
    c.count += 1;
    c.net += signedAmount(t);
    map.set(key, c);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function byAccount(dataset: ExportDataset) {
  const map = new Map<string, { inflow: number; outflow: number; count: number }>();
  for (const t of dataset.transactions) {
    const key = t.accountName ?? "(unassigned)";
    const c = map.get(key) ?? { inflow: 0, outflow: 0, count: 0 };
    c.count += 1;
    if (t.direction === "in") c.inflow += t.amountMinor;
    else if (t.direction === "out") c.outflow += t.amountMinor;
    map.set(key, c);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

// --- sheet rows (for connected workbooks) -------------------------

/**
 * The dataset as `{ name, rows }` sheets keyed by a caller-supplied
 * name map. Header row first. Used by the connected-workbook sync to
 * push OneLedger data into an external spreadsheet.
 */
export function datasetToSheetRows(
  dataset: ExportDataset,
  sheetNames: Partial<Record<
    "transactions" | "income" | "expenses" | "categories" | "accounts",
    string
  >>,
): { name: string; rows: string[][] }[] {
  const s = (v: string | number): string => String(v);
  const out: { name: string; rows: string[][] }[] = [];

  if (sheetNames.transactions) {
    out.push({
      name: sheetNames.transactions,
      rows: [TXN_HEADER, ...dataset.transactions.map((r) => txnValues(r).map(s))],
    });
  }
  if (sheetNames.income) {
    out.push({
      name: sheetNames.income,
      rows: [
        TXN_HEADER,
        ...dataset.transactions.filter((t) => t.direction === "in").map((r) =>
          txnValues(r).map(s)
        ),
      ],
    });
  }
  if (sheetNames.expenses) {
    out.push({
      name: sheetNames.expenses,
      rows: [
        TXN_HEADER,
        ...dataset.transactions.filter((t) => t.direction === "out").map((r) =>
          txnValues(r).map(s)
        ),
      ],
    });
  }
  if (sheetNames.categories) {
    out.push({
      name: sheetNames.categories,
      rows: [
        ["Category", "Transactions", "Net"],
        ...byCategory(dataset).map(([name, c]) => [name, s(c.count), s(c.net)]),
      ],
    });
  }
  if (sheetNames.accounts) {
    out.push({
      name: sheetNames.accounts,
      rows: [
        ["Account", "Transactions", "Money in", "Money out"],
        ...byAccount(dataset).map((
          [name, c],
        ) => [name, s(c.count), s(c.inflow), s(c.outflow)]),
      ],
    });
  }
  return out;
}

// --- XLSX ----------------------------------------------------------

function addSheet(
  wb: ExcelJS.Workbook,
  name: string,
  header: string[],
  rows: (string | number)[][],
  numberCols: number[] = [],
) {
  const ws = wb.addWorksheet(name);
  ws.addRow(header);
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  for (const raw of rows) {
    ws.addRow(
      raw.map((v) => (typeof v === "string" ? neutralizeFormula(v) : v)),
    );
  }
  header.forEach((h, i) => {
    const col = ws.getColumn(i + 1);
    col.width = Math.min(40, Math.max(12, h.length + 2));
    if (numberCols.includes(i)) col.numFmt = "#,##0";
  });
}

export async function buildXlsx(
  dataset: ExportDataset,
  sheets: readonly string[],
): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "OneLedger";
  wb.created = new Date();
  const want = (s: ExportSheet) => sheets.includes(s);

  if (want("Summary")) {
    const rows: (string | number)[][] = [];
    for (const [currency, c] of summarise(dataset)) {
      rows.push([
        currency,
        c.count,
        c.inflow,
        c.outflow,
        c.inflow - c.outflow,
      ]);
    }
    addSheet(
      wb,
      "Summary",
      ["Currency", "Transactions", "Money in", "Money out", "Net"],
      [
        ["Period", dataset.period.label, "", "", ""],
        ["From", ymd(dataset.period.from), "", "", ""],
        ["To", ymd(dataset.period.to), "", "", ""],
        ["", "", "", "", ""],
        ...rows,
      ],
      [1, 2, 3, 4],
    );
  }

  if (want("Transactions")) {
    addSheet(wb, "Transactions", TXN_HEADER, dataset.transactions.map(txnValues), [5]);
  }
  if (want("Income")) {
    const rows = dataset.transactions.filter((t) => t.direction === "in");
    if (rows.length > 0) addSheet(wb, "Income", TXN_HEADER, rows.map(txnValues), [5]);
  }
  if (want("Expenses")) {
    const rows = dataset.transactions.filter((t) => t.direction === "out");
    if (rows.length > 0) {
      addSheet(wb, "Expenses", TXN_HEADER, rows.map(txnValues), [5]);
    }
  }
  if (want("Categories")) {
    const rows = byCategory(dataset).map(([name, c]) => [name, c.count, c.net]);
    if (rows.length > 0) {
      addSheet(wb, "Categories", ["Category", "Transactions", "Net"], rows, [1, 2]);
    }
  }
  if (want("Accounts")) {
    const rows = byAccount(dataset).map(([name, c]) => [
      name,
      c.count,
      c.inflow,
      c.outflow,
    ]);
    if (rows.length > 0) {
      addSheet(
        wb,
        "Accounts",
        ["Account", "Transactions", "Money in", "Money out"],
        rows,
        [1, 2, 3],
      );
    }
  }

  if (wb.worksheets.length === 0) addSheet(wb, "Transactions", TXN_HEADER, [], [5]);

  const buffer = await wb.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}
