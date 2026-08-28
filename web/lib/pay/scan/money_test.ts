import { assertEquals } from "jsr:@std/assert@1";
import { currencyMinorDigits, formatScanAmount } from "./money.ts";

Deno.test("currencyMinorDigits: zero / two / three decimal currencies", () => {
  assertEquals(currencyMinorDigits("RWF"), 0);
  assertEquals(currencyMinorDigits("ugx"), 0);
  assertEquals(currencyMinorDigits("USD"), 2);
  assertEquals(currencyMinorDigits("EUR"), 2);
  assertEquals(currencyMinorDigits("KWD"), 3);
});

Deno.test("formatScanAmount: RWF has no fractional part", () => {
  assertEquals(formatScanAmount({ minor: 5000, currency: "RWF" }), "RWF 5,000");
  assertEquals(formatScanAmount({ minor: 1500000, currency: "RWF" }), "RWF 1,500,000");
});

Deno.test("formatScanAmount: USD splits minor units exactly (no float divide)", () => {
  assertEquals(formatScanAmount({ minor: 1250, currency: "USD" }), "USD 12.50");
  assertEquals(formatScanAmount({ minor: 9, currency: "USD" }), "USD 0.09");
  assertEquals(formatScanAmount({ minor: 100000, currency: "USD" }), "USD 1,000.00");
});

Deno.test("formatScanAmount: three-decimal currency", () => {
  assertEquals(formatScanAmount({ minor: 1, currency: "KWD" }), "KWD 0.001");
});
