// Phase U PR7b: turn mapped CSV cells into the normalized row shape
// import_statement_transactions(p_rows jsonb) expects
// ({ occurred_at, amount_minor, direction, counterparty?, external_ref? }).
// Pure and dependency-free so it can be unit-tested; the RPC re-validates
// everything server-side regardless.

export type DirectionStrategy =
  | "column" // a column holds "in"/"out" (or debit/credit, +/-)
  | "sign" // one signed amount column: negative = out, positive = in
  | "all_out" // every row is money out (e.g. a card-spend statement)
  | "all_in";

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

/** RWF is a zero-decimal currency, so the minor unit is the whole number. Strips symbols, thousands separators, and parenthesised negatives. Returns { minor, negative } or null. */
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

  // Drop everything that isn't a digit, dot, or comma, then treat comma
  // as a thousands separator (RWF statements do not use a decimal comma).
  s = s.replace(/[^\d.,]/g, "").replace(/,/g, "");
  if (!s || !/^\d+(\.\d+)?$/.test(s)) return null;

  const value = Number(s);
  if (!Number.isFinite(value)) return null;
  const minor = Math.round(value);
  if (minor < 0) return null;
  return { minor, negative };
}

/** Accepts ISO (yyyy-mm-dd[ hh:mm[:ss]]), or day/month-first slash or dot dates. Returns an ISO 8601 string (UTC midnight if no time) or null. */
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
    return isoFrom(y, month, day, +(parts[4] ?? 0), +(parts[5] ?? 0), +(parts[6] ?? 0));
  }

  // Last resort: let the engine try (named months etc.).
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
  // Reject rollovers (e.g. 31/02).
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

/** Best-guess column indexes from the header names, to pre-fill the mapping UI. -1 / null when nothing matches. */
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
