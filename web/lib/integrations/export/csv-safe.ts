// CSV / spreadsheet formula-injection defence, shared by the CSV writer
// and the exceljs string cells. A value that a spreadsheet could
// interpret as a formula (starts with = + - @ TAB or CR) is prefixed
// with a single quote so it is stored as literal text. Pure - unit-tested.

const DANGEROUS_PREFIX = /^[=+\-@\t\r]/;

/** True if `value` would be evaluated as a formula by Excel / Sheets. */
export function isFormulaLike(value: string): boolean {
  return DANGEROUS_PREFIX.test(value);
}

/** The value made safe to place in a spreadsheet cell (still raw text). */
export function neutralizeFormula(value: string): string {
  return isFormulaLike(value) ? `'${value}` : value;
}

/** One RFC-4180 CSV field: formula-neutralised, quoted, inner quotes doubled. */
export function csvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '""';
  const raw = typeof value === "number" ? String(value) : neutralizeFormula(value);
  return `"${raw.replace(/"/g, '""')}"`;
}

/** Join one row of already-stringifiable values into a CSV line. */
export function csvRow(values: (string | number | null | undefined)[]): string {
  return values.map(csvField).join(",");
}

/** Build a full CSV document (CRLF line endings, no trailing newline). */
export function csvDocument(
  header: string[],
  rows: (string | number | null | undefined)[][],
): string {
  return [csvRow(header), ...rows.map(csvRow)].join("\r\n");
}
