import "server-only";

import ExcelJS from "exceljs";

// Read an .xlsx workbook into the same { headers, rows } shape as
// web/lib/csv.ts, so the profiling / mapping layers stay source-agnostic.
// Server-only: exceljs is a ~1MB dependency that must never reach the
// browser bundle. .xls (the old binary format) is NOT supported here -
// callers surface a clear "convert to .xlsx or CSV" error instead.

export type XlsxSheet = {
  name: string;
  headers: string[];
  rows: string[][];
};

export type ParsedXlsx = {
  sheets: XlsxSheet[];
};

/** Coerce any exceljs cell value into a trimmed display string. */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const v = value as Record<string, unknown>;
    // formula cell -> its computed result
    if ("result" in v && v.result !== undefined && v.result !== null) {
      return cellText(v.result);
    }
    // hyperlink cell -> its display text
    if (typeof v.text === "string") return v.text.trim();
    // rich-text cell -> concatenated runs
    if (Array.isArray(v.richText)) {
      return v.richText
        .map((run) => (run as { text?: string }).text ?? "")
        .join("")
        .trim();
    }
    if (v.error) return String(v.error);
    return "";
  }
  return String(value).trim();
}

/** Trailing empties are common in spreadsheet exports; drop them per row. */
function trimTrailingEmpties(cells: string[]): string[] {
  let end = cells.length;
  while (end > 0 && cells[end - 1] === "") end -= 1;
  return cells.slice(0, end);
}

export async function parseXlsx(
  data: ArrayBuffer | Uint8Array | Buffer,
): Promise<ParsedXlsx> {
  const workbook = new ExcelJS.Workbook();
  const buffer = Buffer.isBuffer(data)
    ? data
    : Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data);
  try {
    // exceljs's .d.ts types load() as the legacy non-generic Buffer;
    // @types/node@20's Buffer<ArrayBufferLike> is assignment-incompatible
    // with it despite being fine at runtime.
    await workbook.xlsx.load(
      buffer as unknown as Parameters<typeof workbook.xlsx.load>[0],
    );
  } catch {
    throw new Error(
      "That file could not be read as an .xlsx workbook. If it is an older .xls file, re-save it as .xlsx or export a CSV.",
    );
  }

  const sheets: XlsxSheet[] = [];

  workbook.eachSheet((worksheet) => {
    const matrix: string[][] = [];
    worksheet.eachRow({ includeEmpty: false }, (row) => {
      // row.values is 1-indexed (index 0 is always undefined).
      const raw = Array.isArray(row.values) ? row.values.slice(1) : [];
      const cells = raw.map(cellText);
      if (cells.some((c) => c !== "")) {
        matrix.push(trimTrailingEmpties(cells));
      }
    });

    if (matrix.length === 0) {
      sheets.push({ name: worksheet.name, headers: [], rows: [] });
      return;
    }

    const width = matrix.reduce((max, r) => Math.max(max, r.length), 0);
    const pad = (r: string[]) =>
      r.length === width ? r : [...r, ...Array(width - r.length).fill("")];

    const [headerRow, ...rest] = matrix;
    sheets.push({
      name: worksheet.name,
      headers: pad(headerRow).map((h) => h.trim()),
      rows: rest.map(pad).filter((r) => r.some((c) => c.trim() !== "")),
    });
  });

  return { sheets };
}
