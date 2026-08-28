// A minimal RFC-4180-ish CSV parser - just enough for bank statement
// exports (quoted fields, embedded commas / newlines, "" escaping, CRLF
// or LF line endings). No dependency; statement import is the only
// caller. Not a general-purpose parser: it does not handle a custom
// delimiter or a byte-order mark beyond stripping a leading UTF-8 BOM.

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
      // swallow a lone CR or the CR of a CRLF
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

  // trailing field / record (file not ending in a newline)
  if (field.length > 0 || record.length > 0) {
    pushRecord();
  }

  // Drop fully-blank trailing records (a common export artifact).
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
  // Keep only rows with at least one non-blank cell.
  const rows = rest.filter((r) => r.some((c) => c.trim() !== ""));
  return { headers, rows };
}
