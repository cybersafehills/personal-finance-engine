// Deno-side statement parsing for the inbound-email function (ADR 0018
// Slice B). This is a faithful port of the browser-side pure modules the
// manual CSV/PDF import already uses:
//   - web/lib/csv.ts            -> parseCsv
//   - web/lib/statement-import.ts -> parseAmount / parseStatementDate /
//                                    normalizeStatementRow(s) / guessMapping
// plus a small plain-text-body -> rows helper (linesToRows) equivalent to
// the one web/lib/pdf-statement.ts uses for a PDF text layer.
//
// Keep this in sync with those files by hand - the shapes are covered by
// supabase/functions/_shared/tests/statement_parse_test.ts and, on the
// web side, web/lib/*_test.ts. The RPC re-validates every row regardless.

// ===========================================================================
// CSV  (port of web/lib/csv.ts)
// ===========================================================================

export type ParsedCsv = {
  headers: string[];
  rows: string[][];
};

export function parseCsv(input: string): ParsedCsv {
  const text = input.replace(/^﻿/, "");
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  let i = 0;

  const pushField = () => {
    record.push(field);
    field = "";
  };
  const pushRecord = () => {
    pushField();
    records.push(record);
    record = [];
  };

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      pushField();
      i += 1;
      continue;
    }
    if (ch === "\r") {
      if (text[i + 1] === "\n") i += 1;
      pushRecord();
      i += 1;
      continue;
    }
    if (ch === "\n") {
      pushRecord();
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }

  if (field.length > 0 || record.length > 0) {
    pushRecord();
  }

  while (
    records.length > 0 &&
    records[records.length - 1].every((c) => c.trim() === "")
  ) {
    records.pop();
  }

  if (records.length === 0) {
    return { headers: [], rows: [] };
  }

  const [headerRecord, ...rest] = records;
  const headers = headerRecord.map((h) => h.trim());
  const rows = rest.filter((r) => r.some((c) => c.trim() !== ""));
  return { headers, rows };
}

// ===========================================================================
// Row normalizers  (port of web/lib/statement-import.ts)
// ===========================================================================

export type DirectionStrategy = "column" | "sign" | "all_out" | "all_in";
export type DateOrder = "iso" | "dmy" | "mdy";

export type ColumnMapping = {
  date: number;
  amount: number;
  counterparty: number | null;
  externalRef: number | null;
  directionStrategy: DirectionStrategy;
  directionColumn: number | null;
  dateOrder: DateOrder;
};

export type NormalizedStatementRow = {
  occurred_at: string;
  amount_minor: number;
  direction: "in" | "out" | "neutral";
  counterparty: string | null;
  external_ref: string | null;
};

const OUT_WORDS = ["out", "debit", "dr", "withdrawal", "payment", "paid", "-"];
const IN_WORDS = ["in", "credit", "cr", "deposit", "received", "+"];

export function parseAmount(
  raw: string,
): { minor: number; negative: boolean } | null {
  let s = raw.trim();
  if (!s) return null;

  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1);
  } else if (s.startsWith("+")) {
    s = s.slice(1);
  }

  s = s.replace(/[^\d.,]/g, "").replace(/,/g, "");
  if (!s || !/^\d+(\.\d+)?$/.test(s)) return null;

  const value = Number(s);
  if (!Number.isFinite(value)) return null;
  const minor = Math.round(value);
  if (minor < 0) return null;
  return { minor, negative };
}

export function parseStatementDate(
  raw: string,
  order: DateOrder,
): string | null {
  const s = raw.trim();
  if (!s) return null;

  const iso = s.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/,
  );
  if (iso) {
    const [, y, mo, d, h = "00", mi = "00", se = "00"] = iso;
    return isoFrom(+y, +mo, +d, +h, +mi, +se);
  }

  const parts = s.match(
    /^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/,
  );
  if (parts) {
    const a = +parts[1];
    const b = +parts[2];
    let y = +parts[3];
    if (y < 100) y += 2000;
    const [day, month] = order === "mdy" ? [b, a] : [a, b];
    return isoFrom(
      y,
      month,
      day,
      +(parts[4] ?? 0),
      +(parts[5] ?? 0),
      +(parts[6] ?? 0),
    );
  }

  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

function isoFrom(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  se: number,
): string | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || se > 59) {
    return null;
  }
  const dt = new Date(Date.UTC(y, mo - 1, d, h, mi, se));
  if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString();
}

function directionFromWord(raw: string): "in" | "out" | null {
  const w = raw.trim().toLowerCase();
  if (!w) return null;
  if (OUT_WORDS.some((x) => w === x || w.includes(x))) return "out";
  if (IN_WORDS.some((x) => w === x || w.includes(x))) return "in";
  return null;
}

export function normalizeStatementRow(
  cells: string[],
  mapping: ColumnMapping,
): NormalizedStatementRow | null {
  const cell = (i: number | null) =>
    i === null || i < 0 || i >= cells.length ? "" : cells[i];

  const occurred_at = parseStatementDate(cell(mapping.date), mapping.dateOrder);
  if (!occurred_at) return null;

  const amount = parseAmount(cell(mapping.amount));
  if (!amount) return null;

  let direction: "in" | "out" | "neutral";
  switch (mapping.directionStrategy) {
    case "all_out":
      direction = "out";
      break;
    case "all_in":
      direction = "in";
      break;
    case "sign":
      direction = amount.negative ? "out" : "in";
      break;
    case "column": {
      const d = directionFromWord(cell(mapping.directionColumn));
      if (!d) return null;
      direction = d;
      break;
    }
  }

  const counterpartyRaw = cell(mapping.counterparty).trim();
  const externalRefRaw = cell(mapping.externalRef).trim();

  return {
    occurred_at,
    amount_minor: amount.minor,
    direction,
    counterparty: counterpartyRaw || null,
    external_ref: externalRefRaw || null,
  };
}

export type NormalizeResult = {
  rows: NormalizedStatementRow[];
  skipped: number;
};

export function normalizeStatementRows(
  rows: string[][],
  mapping: ColumnMapping,
): NormalizeResult {
  const out: NormalizedStatementRow[] = [];
  let skipped = 0;
  for (const cells of rows) {
    const n = normalizeStatementRow(cells, mapping);
    if (n) out.push(n);
    else skipped += 1;
  }
  return { rows: out, skipped };
}

export function guessMapping(headers: string[]): Partial<ColumnMapping> {
  const find = (...needles: string[]) =>
    headers.findIndex((h) => {
      const l = h.toLowerCase();
      return needles.some((n) => l.includes(n));
    });

  const date = find("date", "posted", "transaction date");
  const amount = find("amount", "value", "debit/credit");
  const counterparty = find(
    "description",
    "narrative",
    "details",
    "payee",
    "counterparty",
    "reference text",
    "particulars",
  );
  const externalRef = find("reference", "ref", "transaction id", "id");
  const directionColumn = find("type", "direction", "dr/cr", "debit/credit");

  return {
    date: date >= 0 ? date : 0,
    amount: amount >= 0 ? amount : 0,
    counterparty: counterparty >= 0 ? counterparty : null,
    externalRef: externalRef >= 0 && externalRef !== date ? externalRef : null,
    directionColumn: directionColumn >= 0 ? directionColumn : null,
    directionStrategy: directionColumn >= 0 ? "column" : "sign",
    dateOrder: "dmy",
  };
}

// ===========================================================================
// Plain-text body -> [Date, Description, Amount] rows
// (equivalent to web/lib/pdf-statement.ts linesToRows, minus the pdf.js
// positioned-item reconstruction - an email body is already line-broken)
// ===========================================================================

const DATE_RE = /\b(\d{4}-\d{2}-\d{2}|\d{1,2}[/.]\d{1,2}[/.]\d{2,4})\b/;
// A money amount: optional sign / paren, grouped thousands, 2-decimal tail.
const AMOUNT_RE = /[-+(]?\d{1,3}(?:[ ,.]?\d{3})*(?:[.,]\d{2})\)?[-+]?/g;

export type StatementRows = {
  headers: string[];
  rows: string[][];
};

/**
 * Keep only lines carrying BOTH a date and at least one money amount, and
 * split each into [Date, Description, Amount]. A second trailing amount
 * (a running balance) is dropped. Feed the result to normalizeStatementRows
 * with { date: 0, amount: 2, directionStrategy: "sign", dateOrder: "dmy" }.
 */
export function linesToRows(text: string): StatementRows {
  const rows: string[][] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const dateMatch = line.match(DATE_RE);
    if (!dateMatch) continue;

    const amounts = line.match(AMOUNT_RE);
    if (!amounts || amounts.length === 0) continue;

    const date = dateMatch[0];
    const amount = amounts[0].trim();

    // Description = everything between the date and the first amount.
    const afterDate = line.slice(
      (dateMatch.index ?? 0) + date.length,
    );
    const amtIdx = afterDate.indexOf(amounts[0]);
    const description = (amtIdx >= 0 ? afterDate.slice(0, amtIdx) : afterDate)
      .replace(/[\s|,:;-]+$/, "")
      .replace(/^[\s|,:;-]+/, "")
      .trim();

    rows.push([date, description, amount]);
  }
  return { headers: ["Date", "Description", "Amount"], rows };
}

export const EMAIL_BODY_MAPPING: ColumnMapping = {
  date: 0,
  amount: 2,
  counterparty: 1,
  externalRef: null,
  directionStrategy: "sign",
  directionColumn: null,
  dateOrder: "dmy",
};
