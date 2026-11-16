import { assertEquals } from "jsr:@std/assert@1";
import {
  counterpartyKeyFor,
  maskMsisdn,
  normalizeLabel,
  normalizeMsisdn,
} from "./normalize.ts";
import vectors from "./msisdn-vectors.json" with { type: "json" };

Deno.test("normalizeMsisdn matches the shared vectors (also asserted in SQL)", () => {
  for (const v of vectors) {
    assertEquals(normalizeMsisdn(v.in), v.out, String(v.in));
  }
});

Deno.test("normalizeLabel collapses whitespace and case", () => {
  assertEquals(
    normalizeLabel("  Samuel   NSHIMIYIMANA "),
    "samuel nshimiyimana",
  );
  assertEquals(normalizeLabel(null), "");
});

Deno.test("strong identifiers win; same name alone is only a weak, low-confidence key", () => {
  assertEquals(
    counterpartyKeyFor({
      transactionType: "send_money",
      name: "Sam",
      reference: "0793000439",
    }),
    {
      type: "msisdn",
      value: "250793000439",
      confidence: "high",
      kind: "person",
    },
  );
  assertEquals(
    counterpartyKeyFor({
      transactionType: "merchant_payment",
      name: "Shop",
      reference: "093011",
    }),
    {
      type: "merchant_code",
      value: "093011",
      confidence: "high",
      kind: "merchant",
    },
  );
  // numeric reference on a non-merchant payment is NOT a merchant code
  assertEquals(
    counterpartyKeyFor({
      transactionType: "send_money",
      name: "Jo",
      reference: "093011",
    })?.type,
    "name_label",
  );
  // masked reference is not an identifier
  assertEquals(
    counterpartyKeyFor({
      transactionType: "send_money",
      name: "Ogabor J",
      reference: "*********901",
    }),
    {
      type: "name_label",
      value: "ogabor j",
      confidence: "low",
      kind: "unknown",
    },
  );
  assertEquals(
    counterpartyKeyFor({
      transactionType: "other",
      name: " ",
      reference: null,
    }),
    null,
  );
});

Deno.test("maskMsisdn", () => {
  assertEquals(maskMsisdn("250793000439"), "25079***439");
});
