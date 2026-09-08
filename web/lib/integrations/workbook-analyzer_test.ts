import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  analyzeSheet,
  analyzeWorkbook,
  recommendedSheetNames,
} from "./workbook-analyzer.ts";

const txnRows = (n: number): string[][] =>
  Array.from({ length: n }, (_, i) => [
    `0${(i % 9) + 1}/02/2026`,
    `Payment ${i}`,
    `${1000 + i}`,
  ]);

Deno.test("a clean transaction sheet is high-confidence and recommended", () => {
  const s = analyzeSheet({
    name: "Sales",
    headers: ["Date", "Description", "Amount"],
    rows: txnRows(20),
  });
  assertEquals(s.kind, "transactions");
  assertEquals(s.confidence, "high");
  assert(s.recommended);
  assertEquals(s.readyRows, 20);
  assert(s.dateRange);
});

Deno.test("a OneLedger starter-template sheet is recognised by name", () => {
  const s = analyzeSheet({
    name: "Cashbook",
    headers: [
      "Date",
      "Description",
      "Reference",
      "Money In",
      "Money Out",
      "Balance",
      "Currency",
    ],
    rows: [["01/02/2026", "Opening", "", "50000", "", "50000", "RWF"]],
  });
  assertEquals(s.kind, "transactions");
  assertEquals(s.confidence, "high");
  assertEquals(s.matchedTemplate, "Cashbook");
});

Deno.test("an empty sheet is 'empty', not a candidate", () => {
  assertEquals(
    analyzeSheet({ name: "Blank", headers: [], rows: [] }).kind,
    "empty",
  );
  const headerOnly = analyzeSheet({
    name: "Template",
    headers: ["Date", "Amount"],
    rows: [["", ""]],
  });
  assertEquals(headerOnly.kind, "empty");
  assert(!headerOnly.recommended);
});

Deno.test("a non-transaction sheet is 'unrecognised' with high confidence", () => {
  const s = analyzeSheet({
    name: "Staff",
    headers: ["Employee", "Role", "Phone"],
    rows: [["Jane", "Cashier", "0788000000"], ["Paul", "Manager", "0788111111"]],
  });
  assertEquals(s.kind, "unrecognised");
  assertEquals(s.confidence, "high");
  assert(!s.recommended);
});

Deno.test("date+amount columns but nothing parses -> low confidence, not recommended", () => {
  const s = analyzeSheet({
    name: "Weird",
    headers: ["Date", "Amount"],
    rows: [["not-a-date", "not-a-number"], ["also bad", "xxx"]],
  });
  assertEquals(s.kind, "transactions");
  assertEquals(s.confidence, "low");
  assert(!s.recommended);
});

Deno.test("mostly-broken transaction sheet is medium confidence but still recommended", () => {
  const rows = [...txnRows(3), ...Array.from({ length: 17 }, () => ["", "junk", ""])];
  const s = analyzeSheet({
    name: "Messy",
    headers: ["Date", "Description", "Amount"],
    rows,
  });
  assertEquals(s.kind, "transactions");
  assertEquals(s.confidence, "medium");
  assert(s.recommended);
});

Deno.test("analyzeWorkbook rolls up candidates and recommended names", () => {
  const wb = analyzeWorkbook([
    { name: "Sales", headers: ["Date", "Description", "Amount"], rows: txnRows(10) },
    { name: "Expenses", headers: ["Date", "Supplier", "Amount"], rows: txnRows(5) },
    { name: "Notes", headers: ["Topic", "Detail"], rows: [["a", "b"]] },
    { name: "Empty", headers: [], rows: [] },
  ]);
  assertEquals(wb.sheetCount, 4);
  assertEquals(wb.candidateSheets, 2);
  assertEquals(wb.candidateRows, 15);
  assertEquals(recommendedSheetNames(wb).sort(), ["Expenses", "Sales"]);
});
