import { assertEquals } from "jsr:@std/assert@1";
import {
  EMAIL_BODY_MAPPING,
  guessMapping,
  linesToRows,
  normalizeStatementRows,
  parseAmount,
  parseCsv,
  parseStatementDate,
} from "../statement-parse.ts";

// This module is a hand-kept port of web/lib/csv.ts + web/lib/statement-import.ts
// (plus a body-line splitter). These tests guard the shapes the
// inbound-email function relies on; the web side has its own fuller suite.

Deno.test("parseCsv: quoted fields, embedded commas, CRLF, BOM", () => {
  const csv = '﻿Date,Amount,Note\r\n2026-01-02,"1,500","a, b"\r\n';
  const { headers, rows } = parseCsv(csv);
  assertEquals(headers, ["Date", "Amount", "Note"]);
  assertEquals(rows, [["2026-01-02", "1,500", "a, b"]]);
});

Deno.test("parseAmount: strips symbols, thousands, parens = negative", () => {
  assertEquals(parseAmount("1,250,000"), { minor: 1_250_000, negative: false });
  assertEquals(parseAmount("(4 500)"), { minor: 4500, negative: true });
  assertEquals(parseAmount("-10.00"), { minor: 10, negative: true });
  assertEquals(parseAmount("RWF 2000"), { minor: 2000, negative: false });
  assertEquals(parseAmount("n/a"), null);
});

Deno.test("parseStatementDate: iso + dmy/mdy + rollover reject", () => {
  assertEquals(
    parseStatementDate("2026-01-02 09:30", "iso"),
    "2026-01-02T09:30:00.000Z",
  );
  assertEquals(
    parseStatementDate("02/01/2026", "dmy"),
    "2026-01-02T00:00:00.000Z",
  );
  assertEquals(
    parseStatementDate("01/02/2026", "mdy"),
    "2026-01-02T00:00:00.000Z",
  );
  assertEquals(parseStatementDate("31/02/2026", "dmy"), null);
});

Deno.test("guessMapping: finds date/amount/description/type columns", () => {
  const m = guessMapping(["Posted Date", "Narrative", "Amount", "Dr/Cr"]);
  assertEquals(m.date, 0);
  assertEquals(m.amount, 2);
  assertEquals(m.counterparty, 1);
  assertEquals(m.directionColumn, 3);
  assertEquals(m.directionStrategy, "column");
});

Deno.test("normalizeStatementRows: sign strategy + skip count", () => {
  const rows = [
    ["02/01/2026", "Coffee", "-4500"],
    ["03/01/2026", "Salary", "1200000"],
    ["bad", "row", "x"],
  ];
  const res = normalizeStatementRows(rows, EMAIL_BODY_MAPPING);
  assertEquals(res.rows.length, 2);
  assertEquals(res.rows[0].direction, "out");
  assertEquals(res.rows[1].direction, "in");
  assertEquals(res.skipped, 1);
});

Deno.test("linesToRows: keeps only date+amount lines, drops a trailing balance", () => {
  const text = [
    "Statement for January",
    "2026-01-04  POS PURCHASE     -1,250.00   98,750.00",
    "  ",
    "2026-01-05  TRANSFER IN       3,000.00  101,750.00",
    "End of statement",
  ].join("\n");
  const { headers, rows } = linesToRows(text);
  assertEquals(headers, ["Date", "Description", "Amount"]);
  assertEquals(rows.length, 2);
  assertEquals(rows[0][0], "2026-01-04");
  assertEquals(rows[0][1], "POS PURCHASE");
  assertEquals(rows[0][2], "-1,250.00");
  assertEquals(rows[1][2], "3,000.00");
});
