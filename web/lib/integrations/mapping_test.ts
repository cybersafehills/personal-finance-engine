import { assertEquals } from "jsr:@std/assert@1";
import {
  headerSignature,
  type ImportColumnMapping,
  isMappingComplete,
  missingRequiredFields,
  normalizeImportRow,
  signatureSimilarity,
  suggestMapping,
} from "./mapping.ts";

Deno.test("suggestMapping picks a split debit/credit layout", () => {
  const m = suggestMapping(
    ["Date", "Narrative", "Debit", "Credit", "Balance", "Reference"],
    "RWF",
  );
  assertEquals(m.amountMode, "split");
  assertEquals(m.columns.outflow, 2);
  assertEquals(m.columns.inflow, 3);
  assertEquals(m.columns.date, 0);
  assertEquals(m.columns.balance, 4);
  assertEquals(isMappingComplete(m), true);
});

Deno.test("suggestMapping picks a single signed amount layout", () => {
  const m = suggestMapping(["Transaction Date", "Details", "Amount"]);
  assertEquals(m.amountMode, "signed");
  assertEquals(m.columns.amount_signed, 2);
  assertEquals(isMappingComplete(m), true);
});

Deno.test("missingRequiredFields reports what's unset", () => {
  const m: ImportColumnMapping = {
    columns: {},
    amountMode: "signed",
    directionMode: "from_amount",
    dateOrder: "dmy",
    defaultCurrency: null,
  };
  assertEquals(missingRequiredFields(m).sort(), ["amount", "date"]);
});

Deno.test("normalizeImportRow: signed amount, sign drives direction", () => {
  const m: ImportColumnMapping = {
    columns: { date: 0, amount_signed: 1, description: 2 },
    amountMode: "signed",
    directionMode: "from_amount",
    dateOrder: "dmy",
    defaultCurrency: "RWF",
  };
  const out = normalizeImportRow(["03/08/2026", "-12,500", "AWS"], m);
  assertEquals(out.ok, true);
  if (out.ok) {
    assertEquals(out.row.amount_minor, 12500);
    assertEquals(out.row.direction, "out");
    assertEquals(out.row.description, "AWS");
    assertEquals(out.row.currency, "RWF");
    assertEquals(out.row.occurred_at, "2026-08-03T00:00:00.000Z");
  }
});

Deno.test("normalizeImportRow: split columns choose the filled side", () => {
  const m: ImportColumnMapping = {
    columns: { date: 0, inflow: 1, outflow: 2 },
    amountMode: "split",
    directionMode: "from_amount",
    dateOrder: "iso",
    defaultCurrency: null,
  };
  const credit = normalizeImportRow(["2026-08-04", "5000", ""], m);
  const debit = normalizeImportRow(["2026-08-05", "", "800"], m);
  assertEquals(credit.ok && credit.row.direction, "in");
  assertEquals(debit.ok && debit.row.direction, "out");
  assertEquals(debit.ok && debit.row.amount_minor, 800);
});

Deno.test("normalizeImportRow: unparseable date and amount are rejected", () => {
  const m: ImportColumnMapping = {
    columns: { date: 0, amount_signed: 1 },
    amountMode: "signed",
    directionMode: "from_amount",
    dateOrder: "dmy",
    defaultCurrency: null,
  };
  assertEquals(normalizeImportRow(["nope", "100"], m), {
    ok: false,
    reason: "unparseable_date",
  });
  assertEquals(normalizeImportRow(["01/08/2026", "abc"], m), {
    ok: false,
    reason: "unparseable_amount",
  });
});

Deno.test("header signature similarity", () => {
  const a = headerSignature([" Date ", "Amount", "Details"]);
  assertEquals(a, ["date", "amount", "details"]);
  assertEquals(signatureSimilarity(a, ["date", "amount", "details"]), 1);
  assertEquals(signatureSimilarity(a, ["date", "amount"]), 2 / 3);
  assertEquals(signatureSimilarity(a, ["x", "y", "z"]), 0);
});
