import { assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import { parseMomoMessage } from "../parser.ts";
import {
  airtimeMessage,
  airtimeRegressionMessage,
  failedTransactionMessage,
  merchantPaymentMessage,
  parserTestCases,
  sendMoneyMessage,
} from "./fixtures.ts";

// ===========================================================================
// Table-driven matrix: every supported format (and every unknown-format
// safety case) is verified field-by-field from a single source of truth in
// fixtures.ts. See parserTestCases for the full list.
// ===========================================================================

for (const testCase of parserTestCases) {
  Deno.test(`parser matrix: ${testCase.name}`, () => {
    const parsed = parseMomoMessage(testCase.raw);

    if (testCase.expected === null) {
      assertEquals(
        parsed,
        null,
        `expected "${testCase.name}" to be rejected (null), but it parsed`,
      );
      return;
    }

    if (parsed === null) {
      throw new Error(
        `expected "${testCase.name}" to parse, but parser returned null`,
      );
    }

    const expected = testCase.expected;

    assertEquals(
      parsed.external_transaction_id,
      expected.external_transaction_id,
    );
    assertEquals(parsed.transaction_type, expected.transaction_type);
    assertEquals(parsed.direction, expected.direction);
    assertEquals(parsed.status, expected.status);
    assertEquals(parsed.amount_rwf, expected.amount_rwf);
    assertEquals(parsed.fee_rwf, expected.fee_rwf);
    assertEquals(parsed.balance_after_rwf, expected.balance_after_rwf);
    assertEquals(parsed.counterparty_name, expected.counterparty_name);
    assertEquals(
      parsed.counterparty_reference,
      expected.counterparty_reference,
    );
    assertEquals(parsed.occurred_at, expected.occurred_at);
    assertEquals(parsed.metadata.parser_pattern, expected.parser_pattern);
  });
}

// ===========================================================================
// Dedicated regression / semantic tests that don't fit the flat matrix.
// ===========================================================================

Deno.test("failed transaction never registers a balance movement (net financial effect stays zero)", () => {
  const parsed = parseMomoMessage(failedTransactionMessage.raw);

  if (parsed === null) {
    throw new Error("Expected failed transaction message to parse");
  }

  // A failed transaction must preserve the attempted amount for visibility,
  // but must never contribute a real ledger debit: fee is forced to zero
  // and the transaction carries status "failed" rather than "success", so
  // downstream net-effect logic can treat it as a zero-sum event.
  assertEquals(parsed.status, "failed");
  assertEquals(parsed.fee_rwf, 0);
  assertEquals(parsed.amount_rwf, failedTransactionMessage.expected.amount_rwf);
});

Deno.test("parsing the same message twice is deterministic (duplicate-format regression)", () => {
  const first = parseMomoMessage(merchantPaymentMessage.raw);
  const second = parseMomoMessage(merchantPaymentMessage.raw);

  assertEquals(first, second);
});

Deno.test("regression: airtime payment is never swallowed by the generic merchant-payment parser", () => {
  const parsed = parseMomoMessage(airtimeRegressionMessage);

  if (parsed === null) {
    throw new Error("Expected airtime message to parse");
  }

  assertEquals(parsed.transaction_type, "airtime");
  assertEquals(parsed.metadata.parser_pattern, "airtime_payment");
  assertEquals(parsed.counterparty_name, "Airtime");
  assertNotEquals(parsed.transaction_type, "merchant_payment");
  assertNotEquals(parsed.metadata.parser_pattern, "merchant_payment");
});

Deno.test("regression: airtime precedence check does not depend on case", () => {
  const parsed = parseMomoMessage(airtimeMessage.raw.toLowerCase());

  if (parsed === null) {
    throw new Error("Expected lowercased airtime message to parse");
  }

  assertEquals(parsed.transaction_type, "airtime");
});

Deno.test("occurred_at converts MTN local date/time into a Rwanda UTC+02:00 offset representation", () => {
  const parsed = parseMomoMessage(sendMoneyMessage.raw);

  if (parsed === null) {
    throw new Error("Expected send money message to parse");
  }

  assertEquals(parsed.occurred_at, "2026-08-18T10:20:09+02:00");
  assertEquals(
    new Date(parsed.occurred_at).toISOString(),
    "2026-08-18T08:20:09.000Z",
  );
});
