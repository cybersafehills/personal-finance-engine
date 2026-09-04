/**
 * Minimal RFC 4180 CSV reader for the reference connector.
 *
 * Handles quoted fields, embedded commas and newlines, doubled-quote
 * escaping (`""` → `"`), and either CRLF or LF line endings. It is pure and
 * synchronous: it returns the header row and the data rows as plain string
 * arrays and leaves all interpretation (column mapping, number parsing) to
 * the caller. No streaming, no BOM stripping beyond a leading U+FEFF, no
 * schema.
 */
export type CsvTable = {
  headers: string[];
  rows: string[][];
};

/** A field or record that is empty once trimmed contributes nothing. */
function isBlankRecord(cells: string[]): boolean {
  return cells.every((cell) => cell.trim() === "");
}

export function parseCsv(input: string): CsvTable {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;

  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  let sawAnyChar = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    sawAnyChar = true;

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      record.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      record.push(field);
      records.push(record);
      field = "";
      record = [];
    } else {
      field += char;
    }
  }

  if (field !== "" || record.length > 0) {
    record.push(field);
    records.push(record);
  }

  if (!sawAnyChar || records.length === 0) {
    return { headers: [], rows: [] };
  }

  const [headers, ...rows] = records;
  return {
    headers: headers.map((header) => header.trim()),
    rows: rows.filter((row) => !isBlankRecord(row)),
  };
}
