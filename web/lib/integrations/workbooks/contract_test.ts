import { assertEquals } from "jsr:@std/assert@1";
import {
  defaultSheetMap,
  isRealWorkbookProvider,
  normalizeSheetMap,
  WORKBOOK_PROVIDER_LABEL,
  WORKBOOK_PROVIDERS,
} from "./contract.ts";

Deno.test("only manual_file is a real provider", () => {
  assertEquals(isRealWorkbookProvider("manual_file"), true);
  assertEquals(isRealWorkbookProvider("google_sheets"), false);
  assertEquals(isRealWorkbookProvider("excel_365"), false);
});

Deno.test("every provider has a label", () => {
  for (const p of WORKBOOK_PROVIDERS) {
    assertEquals(WORKBOOK_PROVIDER_LABEL[p].length > 0, true);
  }
});

Deno.test("defaultSheetMap covers the five datasets", () => {
  assertEquals(Object.keys(defaultSheetMap()).sort(), [
    "accounts",
    "categories",
    "expenses",
    "income",
    "transactions",
  ]);
});

Deno.test("normalizeSheetMap keeps known, non-empty names and drops junk", () => {
  assertEquals(
    normalizeSheetMap({ transactions: " Txns ", bogus: "x", income: "" }),
    { transactions: "Txns" },
  );
  // empty / invalid input falls back to the default
  assertEquals(normalizeSheetMap(null), defaultSheetMap());
  assertEquals(normalizeSheetMap({ nope: 1 }), defaultSheetMap());
});
