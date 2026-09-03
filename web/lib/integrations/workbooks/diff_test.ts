import { assertEquals } from "jsr:@std/assert@1";
import {
  diffWorkbookAgainstLedger,
  type LedgerRowForDiff,
} from "./diff.ts";

const HEADER = [
  "Date",
  "Description",
  "Reference",
  "Transaction ID",
  "Direction",
  "Amount",
  "Currency",
  "Category",
  "Account",
];

function ledger(o: Partial<LedgerRowForDiff>): LedgerRowForDiff {
  return {
    id: "txn-1",
    occurredAt: "2026-08-10T09:00:00.000Z",
    description: "Coffee shop",
    reference: null,
    externalId: "EXT-1",
    direction: "out",
    amountMinor: 4200,
    currency: "RWF",
    category: "Meals",
    accountName: "Main",
    ...o,
  };
}

Deno.test("matched row with a changed category -> one field_changed conflict", () => {
  const rows = [
    HEADER,
    ["2026-08-10", "Coffee shop", "", "EXT-1", "out", "-4200", "RWF", "Coffee", "Main"],
  ];
  const r = diffWorkbookAgainstLedger(rows, [ledger({})]);
  assertEquals(r.matched, 1);
  assertEquals(r.conflicts.length, 1);
  assertEquals(r.conflicts[0].kind, "field_changed");
  assertEquals(r.conflicts[0].field, "category");
  assertEquals(r.conflicts[0].oneledgerValue, "Meals");
  assertEquals(r.conflicts[0].externalValue, "Coffee");
});

Deno.test("identical row -> no conflict", () => {
  const rows = [
    HEADER,
    ["2026-08-10", "Coffee shop", "", "EXT-1", "out", "-4200", "RWF", "Meals", "Main"],
  ];
  assertEquals(diffWorkbookAgainstLedger(rows, [ledger({})]).conflicts.length, 0);
});

Deno.test("row only in the workbook -> row_only_in_workbook conflict", () => {
  const rows = [
    HEADER,
    ["2026-08-11", "New thing", "", "EXT-99", "in", "1000", "RWF", "Income", "Main"],
  ];
  const r = diffWorkbookAgainstLedger(rows, [ledger({})]);
  assertEquals(r.unmatched, 1);
  assertEquals(r.conflicts[0].kind, "row_only_in_workbook");
  assertEquals(r.conflicts[0].refId, null);
});

Deno.test("matches on amount+direction+day+description when no external id", () => {
  const rows = [
    HEADER,
    ["2026-08-10", "Coffee shop", "", "", "out", "-4200", "RWF", "Coffee", "Main"],
  ];
  const r = diffWorkbookAgainstLedger(rows, [ledger({ externalId: null })]);
  assertEquals(r.matched, 1);
  assertEquals(r.conflicts[0].field, "category");
});
