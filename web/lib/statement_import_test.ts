import { assertEquals } from "jsr:@std/assert@1";
import { parseCsv } from "./csv.ts";
import {
  type ColumnMapping,
  guessMapping,
  normalizeStatementRows,
  parseAmount,
  parseStatementDate,
} from "./statement-import.ts";

Deno.test("parseCsv: quoted fields with embedded commas and newlines, CRLF, and '' escaping", () => {
  const text =
    'Date,Details,Amount\r\n2026-08-01,"SHOP, LTD",1000\r\n2026-08-02,"Line one\nLine two",2500\r\n2026-08-03,"He said ""hi""",300\r\n';
  const { headers, rows } = parseCsv(text);
  assertEquals(headers, ["Date", "Details", "Amount"]);
  assertEquals(rows.length, 3);
  assertEquals(rows[0], ["2026-08-01", "SHOP, LTD", "1000"]);
  assertEquals(rows[1][1], "Line one\nLine two");
  assertEquals(rows[2][1], 'He said "hi"');
});

Deno.test("parseCsv: strips a UTF-8 BOM and drops blank trailing rows", () => {
  const { headers, rows } = parseCsv("﻿a,b\n1,2\n\n\n");
  assertEquals(headers, ["a", "b"]);
  assertEquals(rows, [["1", "2"]]);
});

Deno.test("parseAmount: symbols, thousands separators, parens and sign", () => {
  assertEquals(parseAmount("RWF 1,234"), { minor: 1234, negative: false });
  assertEquals(parseAmount("(2,000)"), { minor: 2000, negative: true });
  assertEquals(parseAmount("-500"), { minor: 500, negative: true });
  assertEquals(parseAmount("+ 7 500"), { minor: 7500, negative: false });
  assertEquals(parseAmount("1234.6"), { minor: 1235, negative: false });
  assertEquals(parseAmount(""), null);
  assertEquals(parseAmount("n/a"), null);
});

Deno.test("parseStatementDate: iso, day-first and month-first slash dates", () => {
  assertEquals(parseStatementDate("2026-08-20", "iso"), "2026-08-20T00:00:00.000Z");
  assertEquals(
    parseStatementDate("2026-08-20 14:30", "iso"),
    "2026-08-20T14:30:00.000Z",
  );
  assertEquals(parseStatementDate("03/08/2026", "dmy"), "2026-08-03T00:00:00.000Z");
  assertEquals(parseStatementDate("03/08/2026", "mdy"), "2026-03-08T00:00:00.000Z");
  assertEquals(parseStatementDate("1.9.26", "dmy"), "2026-09-01T00:00:00.000Z");
  assertEquals(parseStatementDate("31/02/2026", "dmy"), null); // rollover rejected
  assertEquals(parseStatementDate("", "dmy"), null);
});

Deno.test("guessMapping: picks obvious columns from the header names", () => {
  const m = guessMapping(["Posted Date", "Narrative", "Type", "Amount", "Reference"]);
  assertEquals(m.date, 0);
  assertEquals(m.counterparty, 1);
  assertEquals(m.directionColumn, 2);
  assertEquals(m.amount, 3);
  assertEquals(m.externalRef, 4);
  assertEquals(m.directionStrategy, "column");
});

const BASE_MAPPING: ColumnMapping = {
  date: 0,
  amount: 2,
  counterparty: 1,
  externalRef: null,
  directionStrategy: "sign",
  directionColumn: null,
  dateOrder: "dmy",
};

Deno.test("normalizeStatementRows: sign strategy - negative is out, positive is in", () => {
  const { rows, skipped } = normalizeStatementRows(
    [
      ["20/08/2026", "SIMBA SUPERMARKET", "-7,500"],
      ["21/08/2026", "SALARY", "450000"],
    ],
    BASE_MAPPING,
  );
  assertEquals(skipped, 0);
  assertEquals(rows[0], {
    occurred_at: "2026-08-20T00:00:00.000Z",
    amount_minor: 7500,
    direction: "out",
    counterparty: "SIMBA SUPERMARKET",
    external_ref: null,
  });
  assertEquals(rows[1].direction, "in");
  assertEquals(rows[1].amount_minor, 450000);
});

Deno.test("normalizeStatementRows: column strategy - debit/credit words, unparseable rows are skipped not fatal", () => {
  const mapping: ColumnMapping = {
    ...BASE_MAPPING,
    directionStrategy: "column",
    directionColumn: 3,
  };
  const { rows, skipped } = normalizeStatementRows(
    [
      ["20/08/2026", "SHOP", "7500", "Debit"],
      ["21/08/2026", "REFUND", "1000", "Credit"],
      ["not a date", "X", "1000", "Debit"],
      ["22/08/2026", "Y", "abc", "Debit"],
      ["23/08/2026", "Z", "1000", "???"],
    ],
    mapping,
  );
  assertEquals(rows.length, 2);
  assertEquals(skipped, 3);
  assertEquals(rows[0].direction, "out");
  assertEquals(rows[1].direction, "in");
});

Deno.test("normalizeStatementRows: all_out strategy forces every row to money out", () => {
  const { rows } = normalizeStatementRows(
    [["20/08/2026", "CARD SPEND", "1200"]],
    { ...BASE_MAPPING, directionStrategy: "all_out" },
  );
  assertEquals(rows[0].direction, "out");
});
