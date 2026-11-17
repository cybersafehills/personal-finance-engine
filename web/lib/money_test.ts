import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  divRoundBigInt,
  formatMoney,
  isSupportedCurrency,
  minorUnitsPerMajor,
  toMajorUnits,
  toMinorUnits,
} from "./money.ts";

Deno.test("minorUnitsPerMajor: RWF has 0 decimal places (1 minor unit = 1 RWF)", () => {
  assertEquals(minorUnitsPerMajor("RWF"), 1);
});

Deno.test("minorUnitsPerMajor: EUR and USD have 2 decimal places", () => {
  assertEquals(minorUnitsPerMajor("EUR"), 100);
  assertEquals(minorUnitsPerMajor("USD"), 100);
});

Deno.test("isSupportedCurrency: accepts RWF/EUR/USD, rejects anything else", () => {
  assertEquals(isSupportedCurrency("RWF"), true);
  assertEquals(isSupportedCurrency("EUR"), true);
  assertEquals(isSupportedCurrency("USD"), true);
  assertEquals(isSupportedCurrency("GBP"), false);
  assertEquals(isSupportedCurrency(""), false);
});

Deno.test("toMinorUnits: RWF whole-number amount round-trips exactly", () => {
  assertEquals(toMinorUnits("500000", "RWF"), 500000n);
});

Deno.test("toMinorUnits: EUR/USD amounts convert to cents", () => {
  assertEquals(toMinorUnits("1250.50", "EUR"), 125050n);
  assertEquals(toMinorUnits("1250.5", "USD"), 125050n);
});

Deno.test("toMinorUnits: RWF ignores any fractional text (0 decimal places)", () => {
  assertEquals(toMinorUnits("500000.9", "RWF"), 500001n); // rounds up per the half-up rule
  assertEquals(toMinorUnits("500000.4", "RWF"), 500000n);
});

Deno.test("toMinorUnits: exact decimal-string half-up rounding at the currency's own precision boundary", () => {
  // The classic floating-point trap: 1.005 as a double is actually
  // ~1.00499999999999989..., so a multiply-based implementation would
  // wrongly round this down. Parsing the text digits directly avoids it.
  assertEquals(toMinorUnits("1.005", "EUR"), 101n);
  assertEquals(toMinorUnits("1.004", "EUR"), 100n);
  assertEquals(toMinorUnits("-1.005", "EUR"), -101n);
});

Deno.test("toMinorUnits: zero is zero in every currency", () => {
  assertEquals(toMinorUnits("0", "RWF"), 0n);
  assertEquals(toMinorUnits("0.00", "EUR"), 0n);
});

Deno.test("toMinorUnits: rejects non-numeric or malformed input", () => {
  assertThrows(() => toMinorUnits("abc", "RWF"), RangeError);
  assertThrows(() => toMinorUnits("1.2.3", "USD"), RangeError);
  assertThrows(() => toMinorUnits("", "RWF"), RangeError);
  assertThrows(() => toMinorUnits("1e10", "USD"), RangeError);
});

Deno.test("toMajorUnits: inverse of toMinorUnits for whole RWF", () => {
  assertEquals(toMajorUnits(500000n, "RWF"), 500000);
});

Deno.test("toMajorUnits: inverse of toMinorUnits for EUR cents", () => {
  assertEquals(toMajorUnits(125050n, "EUR"), 1250.5);
});

Deno.test("formatMoney: RWF is exact and runtime-independent (never the short 'RF')", () => {
  // Node renders en-RW's currency as "RF 500,000", Deno as "RWF 500,000"; the
  // live site showed the former while the tests passed. Written by hand now.
  assertEquals(formatMoney(500000n, "RWF"), "500,000 RWF");
  assertEquals(formatMoney(0n, "RWF"), "0 RWF");
  assertEquals(formatMoney(999n, "RWF"), "999 RWF");
  assertEquals(formatMoney(1234567890n, "RWF"), "1,234,567,890 RWF");
  assertEquals(formatMoney(-5000n, "RWF"), "\u22125,000 RWF");
  assertEquals(formatMoney(500000n, "RWF").includes("RF "), false);
});

Deno.test("formatMoney: EUR/USD format with exactly two decimal places", () => {
  assertEquals(formatMoney(125050n, "USD").includes("1,250.50"), true);
});

Deno.test("divRoundBigInt: exact division", () => {
  assertEquals(divRoundBigInt(12n, 4n), 3n);
});

Deno.test("divRoundBigInt: rounds half-up (positive)", () => {
  assertEquals(divRoundBigInt(5n, 2n), 3n); // 2.5 -> 3
  assertEquals(divRoundBigInt(3n, 2n), 2n); // 1.5 -> 2
  assertEquals(divRoundBigInt(1n, 4n), 0n); // 0.25 -> 0
});

Deno.test("divRoundBigInt: rounds half-up (negative)", () => {
  assertEquals(divRoundBigInt(-5n, 2n), -3n);
});

Deno.test("divRoundBigInt: annual income normalization example (weekly -> monthly)", () => {
  // 52 weeks * 100,000 RWF = 5,200,000 annual; /12 = 433,333.33 -> 433333
  assertEquals(divRoundBigInt(5_200_000n, 12n), 433333n);
});

Deno.test("divRoundBigInt: rejects zero denominator", () => {
  assertThrows(() => divRoundBigInt(1n, 0n), RangeError);
});
