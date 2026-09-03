import { assertEquals } from "jsr:@std/assert@1";
import { profileTabularData } from "./profile.ts";

Deno.test("profileTabularData reads a clean bank export", () => {
  const headers = ["Transaction Date", "Details", "Amount", "Balance", "Ref"];
  const rows = [
    ["01/08/2026", "AWS EMEA", "-42,000", "158,000", "TXN-1"],
    ["03/08/2026", "Client payment", "250,000", "408,000", "TXN-2"],
    ["07/08/2026", "MTN airtime", "-1,000", "407,000", "TXN-3"],
  ];
  const p = profileTabularData(headers, rows);

  assertEquals(p.rowCount, 3);
  assertEquals(p.columnCount, 5);
  assertEquals(p.columnGuess.date, 0);
  assertEquals(p.columnGuess.amount, 2);
  assertEquals(p.columnGuess.balance, 3);
  assertEquals(p.columnGuess.reference, 4);
  assertEquals(p.probableType, "bank_transactions");
  assertEquals(p.dateRange, {
    start: "2026-08-01T00:00:00.000Z",
    end: "2026-08-07T00:00:00.000Z",
  });
  assertEquals(p.invalidRows, 0);
  assertEquals(p.readyRows, 3);
});

Deno.test("profileTabularData flags invalid rows and repeated headers", () => {
  const headers = ["Date", "Amount", "Description"];
  const rows = [
    ["2026-08-01", "1000", "ok"],
    ["not-a-date", "500", "bad date"],
    ["2026-08-03", "", "missing amount"],
    ["Date", "Amount", "Description"], // a repeated header row
    ["", "", ""], // a blank row
  ];
  const p = profileTabularData(headers, rows);

  assertEquals(p.repeatedHeaderRows, 1);
  assertEquals(p.blankRows, 1);
  assertEquals(p.invalidRows, 2);
  assertEquals(p.readyRows, 1);
});

Deno.test("profileTabularData guesses currency from a code in the data", () => {
  const headers = ["Date", "Amount", "Currency"];
  const rows = [
    ["2026-08-01", "1000", "RWF"],
    ["2026-08-02", "2000", "RWF"],
  ];
  assertEquals(profileTabularData(headers, rows).currencyGuess, "RWF");
});

Deno.test("profileTabularData is honest about an unrecognised file", () => {
  const headers = ["col_a", "col_b", "col_c"];
  const rows = [["x", "y", "z"]];
  const p = profileTabularData(headers, rows);
  assertEquals(p.columnGuess.date, null);
  assertEquals(p.columnGuess.amount, null);
  assertEquals(p.probableType, "unknown");
  assertEquals(p.dateRange, null);
});
