import { assertEquals } from "jsr:@std/assert@1";
import {
  csvDocument,
  csvField,
  csvRow,
  isFormulaLike,
  neutralizeFormula,
} from "./csv-safe.ts";

Deno.test("isFormulaLike catches the dangerous prefixes", () => {
  for (const v of ["=1+1", "+1", "-1", "@SUM(A1)", "\tx", "\rx"]) {
    assertEquals(isFormulaLike(v), true, v);
  }
  for (const v of ["1-1", "hello", " =1", "RWF 100"]) {
    assertEquals(isFormulaLike(v), false, v);
  }
});

Deno.test("neutralizeFormula only prefixes when needed", () => {
  assertEquals(neutralizeFormula("=cmd|' /c calc'!A0"), "'=cmd|' /c calc'!A0");
  assertEquals(neutralizeFormula("Coffee shop"), "Coffee shop");
});

Deno.test("csvField quotes, doubles quotes, neutralizes formulas", () => {
  assertEquals(csvField("plain"), '"plain"');
  assertEquals(csvField('say "hi"'), '"say ""hi"""');
  assertEquals(csvField("=danger"), `"'=danger"`);
  assertEquals(csvField(1500), '"1500"');
  assertEquals(csvField(null), '""');
});

Deno.test("csvRow and csvDocument assemble CRLF output", () => {
  assertEquals(csvRow(["a", "b"]), '"a","b"');
  assertEquals(
    csvDocument(["Date", "Amount"], [["2026-08-01", 100], ["2026-08-02", -50]]),
    '"Date","Amount"\r\n"2026-08-01","100"\r\n"2026-08-02","-50"',
  );
});
