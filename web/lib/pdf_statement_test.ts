import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  itemsToLines,
  linesToRows,
  looksLikeAmount,
  type PdfTextItem,
} from "./pdf-statement.ts";

Deno.test("itemsToLines groups by y and orders each line left-to-right", () => {
  const items: PdfTextItem[] = [
    { str: "Amount", x: 300, y: 700 },
    { str: "Date", x: 10, y: 700 },
    { str: "Description", x: 80, y: 700 },
    { str: "01/02/2026", x: 10, y: 680 },
    { str: "Coffee shop", x: 80, y: 680 },
    { str: "-3.50", x: 300, y: 680 },
  ];
  const lines = itemsToLines(items);
  assertEquals(lines[0], "Date   Description   Amount");
  assertEquals(lines[1], "01/02/2026   Coffee shop   -3.50");
});

Deno.test("looksLikeAmount: decimals and thousands only, never a bare year", () => {
  for (const good of ["-3.50", "1,234.56", "1 234,56", "(45.00)", "12,000"]) {
    assert(looksLikeAmount(good), good);
  }
  for (const bad of ["2026", "42", "ref12345", "12/03/2026"]) {
    assert(!looksLikeAmount(bad), bad);
  }
});

Deno.test("linesToRows keeps date+amount lines and splits date/description/amount", () => {
  const { headers, rows } = linesToRows([
    "Statement for account ****1234",
    "Opening balance                     1,000.00",
    "01/02/2026   Coffee shop            -3.50      996.50",
    "03/02/2026   Salary ACME Corp     2,500.00    3,496.50",
    "page 1 of 2",
  ]);
  assertEquals(headers, ["Date", "Description", "Amount"]);
  assertEquals(rows, [
    ["01/02/2026", "Coffee shop", "-3.50"],
    ["03/02/2026", "Salary ACME Corp", "2,500.00"],
  ]);
});

Deno.test("linesToRows: first of two trailing amounts is the transaction, balance ignored", () => {
  const { rows } = linesToRows([
    "12 Mar 2026  ATM withdrawal  -100.00  1,900.00",
  ]);
  assertEquals(rows, [["12 Mar 2026", "ATM withdrawal", "-100.00"]]);
});

Deno.test("linesToRows: no date or no amount -> dropped", () => {
  assertEquals(linesToRows(["just some words", "2026 summary total 5"]).rows, []);
});

Deno.test("linesToRows: ISO dates and parenthesised amounts", () => {
  const { rows } = linesToRows(["2026-02-01  Refund  (12.00)"]);
  assertEquals(rows, [["2026-02-01", "Refund", "(12.00)"]]);
});
