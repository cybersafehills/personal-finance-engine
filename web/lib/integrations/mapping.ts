// The reusable column-mapping engine for the Import Studio. Pure and
// dependency-light (only the statement-import primitives, which are
// themselves pure) so it runs in a client component for the live mapping
// preview AND on the server for the authoritative apply. The server
// always re-normalizes and re-validates regardless of anything computed
// on the client.

import {
  parseAmount,
  parseStatementDate,
  type DateOrder,
} from "../statement-import.ts";
import type { CanonicalImportField } from "./model.ts";

export type AmountMode =
  | "signed" // one column; negative = money out
  | "split" // separate inflow / outflow columns
  | "all_out" // every row is money out
  | "all_in";

export type DirectionMode =
  | "from_amount" // derive from the amount sign / which of inflow|outflow is filled
  | "column"; // a dedicated in/out (or debit/credit) column

export type ImportColumnMapping = {
  /** canonical field -> 0-based source column index. Absent = unmapped. */
  columns: Partial<Record<CanonicalImportField, number>>;
  amountMode: AmountMode;
  directionMode: DirectionMode;
  dateOrder: DateOrder;
  /** applied when the row carries no currency column. */
  defaultCurrency: string | null;
};

export type NormalizedImportRow = {
  occurred_at: string;
  amount_minor: number;
  direction: "in" | "out" | "neutral";
  description: string | null;
  merchant: string | null;
  external_reference: string | null;
  external_transaction_id: string | null;
  balance_minor: number | null;
  currency: string | null;
  category: string | null;
};

export type NormalizeRowResult =
  | { ok: true; row: NormalizedImportRow }
  | { ok: false; reason: string };

const OUT_WORDS = ["out", "debit", "dr", "withdrawal", "payment", "paid", "-"];
const IN_WORDS = ["in", "credit", "cr", "deposit", "received", "+"];

/** Fields a mapping must resolve before a batch can be validated. */
export function missingRequiredFields(mapping: ImportColumnMapping): string[] {
  const missing: string[] = [];
  if (mapping.columns.date === undefined) missing.push("date");

  if (mapping.amountMode === "signed") {
    if (mapping.columns.amount_signed === undefined) missing.push("amount");
  } else if (mapping.amountMode === "split") {
    if (
      mapping.columns.inflow === undefined &&
      mapping.columns.outflow === undefined
    ) {
      missing.push("inflow or outflow");
    }
  }
  // all_out / all_in still need a magnitude column
  if (
    (mapping.amountMode === "all_out" || mapping.amountMode === "all_in") &&
    mapping.columns.amount_signed === undefined &&
    mapping.columns.inflow === undefined &&
    mapping.columns.outflow === undefined
  ) {
    missing.push("amount");
  }

  if (
    mapping.directionMode === "column" &&
    mapping.columns.direction === undefined
  ) {
    missing.push("direction column");
  }
  return missing;
}

export function isMappingComplete(mapping: ImportColumnMapping): boolean {
  return missingRequiredFields(mapping).length === 0;
}

function cell(cells: string[], index: number | undefined): string {
  if (index === undefined || index < 0 || index >= cells.length) return "";
  return cells[index].trim();
}

function directionFromWord(raw: string): "in" | "out" | null {
  const w = raw.trim().toLowerCase();
  if (!w) return null;
  if (OUT_WORDS.some((x) => w === x || w.includes(x))) return "out";
  if (IN_WORDS.some((x) => w === x || w.includes(x))) return "in";
  return null;
}

/** Turn one file row into the canonical shape, or explain why it can't. */
export function normalizeImportRow(
  cells: string[],
  mapping: ImportColumnMapping,
): NormalizeRowResult {
  const occurred_at = parseStatementDate(
    cell(cells, mapping.columns.date),
    mapping.dateOrder,
  );
  if (!occurred_at) return { ok: false, reason: "unparseable_date" };

  let magnitude: number | null = null;
  let signNegative = false;

  if (mapping.amountMode === "split") {
    const inflow = parseAmount(cell(cells, mapping.columns.inflow));
    const outflow = parseAmount(cell(cells, mapping.columns.outflow));
    if (outflow && outflow.minor > 0) {
      magnitude = outflow.minor;
      signNegative = true;
    } else if (inflow && inflow.minor > 0) {
      magnitude = inflow.minor;
      signNegative = false;
    } else {
      magnitude = 0;
    }
  } else {
    const source = mapping.columns.amount_signed ?? mapping.columns.inflow ??
      mapping.columns.outflow;
    const parsed = parseAmount(cell(cells, source));
    if (!parsed) return { ok: false, reason: "unparseable_amount" };
    magnitude = parsed.minor;
    signNegative = parsed.negative;
  }

  let direction: "in" | "out" | "neutral";
  if (mapping.directionMode === "column") {
    const d = directionFromWord(cell(cells, mapping.columns.direction));
    if (!d) return { ok: false, reason: "unreadable_direction" };
    direction = d;
  } else {
    switch (mapping.amountMode) {
      case "all_out":
        direction = "out";
        break;
      case "all_in":
        direction = "in";
        break;
      case "split":
        direction = signNegative ? "out" : "in";
        break;
      default:
        direction = signNegative ? "out" : "in";
    }
  }

  const balanceParsed = parseAmount(cell(cells, mapping.columns.balance));
  const currencyCell = cell(cells, mapping.columns.currency).toUpperCase();

  const nn = (v: string) => (v ? v : null);

  return {
    ok: true,
    row: {
      occurred_at,
      amount_minor: magnitude,
      direction,
      description: nn(cell(cells, mapping.columns.description)),
      merchant: nn(cell(cells, mapping.columns.merchant)),
      external_reference: nn(cell(cells, mapping.columns.external_reference)),
      external_transaction_id: nn(
        cell(cells, mapping.columns.external_transaction_id),
      ),
      balance_minor: balanceParsed ? balanceParsed.minor : null,
      currency: currencyCell || mapping.defaultCurrency,
      category: nn(cell(cells, mapping.columns.category)),
    },
  };
}

// --- template signature matching ----------------------------------------

/** Stable, comparable form of a file's header row. */
export function headerSignature(headers: string[]): string[] {
  return headers.map((h) => h.trim().toLowerCase()).filter((h) => h.length > 0);
}

/** Jaccard overlap of two header signatures, 0..1. */
export function signatureSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const x of setA) if (setB.has(x)) intersection += 1;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Below this, a saved template is offered but not auto-applied. */
export const TEMPLATE_AUTO_APPLY_THRESHOLD = 0.85;

// --- initial suggestion -------------------------------------------------

function find(headers: string[], needles: string[]): number | undefined {
  const i = headers.findIndex((h) => {
    const l = h.toLowerCase();
    return needles.some((n) => l.includes(n));
  });
  return i >= 0 ? i : undefined;
}

/** Best-guess starting mapping from header names alone. */
export function suggestMapping(
  headers: string[],
  defaultCurrency: string | null = null,
): ImportColumnMapping {
  const date = find(headers, ["date", "posted", "transaction date"]);
  const debit = find(headers, ["debit", "withdrawal", "money out", "paid out"]);
  const credit = find(headers, ["credit", "deposit", "money in", "paid in"]);
  const amount = find(headers, ["amount", "value"]);
  const directionCol = find(headers, ["type", "dr/cr", "debit/credit", "direction"]);

  const columns: ImportColumnMapping["columns"] = {};
  if (date !== undefined) columns.date = date;
  columns.description = find(headers, [
    "description",
    "narrative",
    "details",
    "particulars",
    "reference text",
  ]);
  columns.merchant = find(headers, ["merchant", "payee", "counterparty", "name"]);
  columns.external_reference = find(headers, ["reference", "ref"]);
  columns.external_transaction_id = find(headers, [
    "transaction id",
    "txn id",
    "transaction ref",
    "trans id",
  ]);
  columns.balance = find(headers, ["balance"]);
  columns.currency = find(headers, ["currency", "ccy"]);
  columns.category = find(headers, ["category"]);

  let amountMode: AmountMode = "signed";
  if (debit !== undefined || credit !== undefined) {
    amountMode = "split";
    if (debit !== undefined) columns.outflow = debit;
    if (credit !== undefined) columns.inflow = credit;
  } else if (amount !== undefined) {
    columns.amount_signed = amount;
  }

  let directionMode: DirectionMode = "from_amount";
  if (directionCol !== undefined && amountMode !== "split") {
    directionMode = "column";
    columns.direction = directionCol;
  }

  // strip undefined entries so the shape is clean
  for (const key of Object.keys(columns) as CanonicalImportField[]) {
    if (columns[key] === undefined) delete columns[key];
  }

  return {
    columns,
    amountMode,
    directionMode,
    dateOrder: "dmy",
    defaultCurrency,
  };
}
