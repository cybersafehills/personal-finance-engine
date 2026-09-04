import { assertEquals } from "jsr:@std/assert@1";
import { parseCsv } from "../csv.ts";

Deno.test("parseCsv splits a plain table and trims the header row", () => {
  const table = parseCsv(
    "id,date,amount\nr1,2026-01-05,10\nr2,2026-01-06,20\n",
  );
  assertEquals(table.headers, ["id", "date", "amount"]);
  assertEquals(table.rows, [
    ["r1", "2026-01-05", "10"],
    ["r2", "2026-01-06", "20"],
  ]);
});

Deno.test("parseCsv honours quoted commas, doubled quotes and CRLF", () => {
  const table = parseCsv(
    'id,description\r\nr1,"Salary, January"\r\nr2,"Quote ""x"" here"\r\n',
  );
  assertEquals(table.rows, [
    ["r1", "Salary, January"],
    ["r2", 'Quote "x" here'],
  ]);
});

Deno.test("parseCsv keeps embedded newlines inside quotes and drops blank lines", () => {
  const table = parseCsv('id,note\nr1,"line one\nline two"\n\n\nr2,plain\n');
  assertEquals(table.rows, [
    ["r1", "line one\nline two"],
    ["r2", "plain"],
  ]);
});

Deno.test("parseCsv strips a leading BOM and tolerates a missing final newline", () => {
  const table = parseCsv("﻿id,amount\nr1,5");
  assertEquals(table.headers, ["id", "amount"]);
  assertEquals(table.rows, [["r1", "5"]]);
});

Deno.test("parseCsv returns empty structure for empty input", () => {
  assertEquals(parseCsv(""), { headers: [], rows: [] });
});
