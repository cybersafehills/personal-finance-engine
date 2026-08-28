import { assertEquals } from "jsr:@std/assert@1";
import {
  currencyMinorDigits,
  decimalStringToMinor,
  normalizeCurrencyCode,
  normalizeDate,
  normalizeDecimalString,
  normalizeMoneyToMinor,
  normalizeSupplierName,
  normalizeTaxRate,
} from "./normalize.ts";

Deno.test("normalizeCurrencyCode: codes, symbols, noise", () => {
  assertEquals(normalizeCurrencyCode("usd"), "USD");
  assertEquals(normalizeCurrencyCode(" EUR "), "EUR");
  assertEquals(normalizeCurrencyCode("(RWF)"), "RWF");
  assertEquals(normalizeCurrencyCode("$"), "USD");
  assertEquals(normalizeCurrencyCode("€"), "EUR");
  assertEquals(normalizeCurrencyCode("FRw"), "RWF");
  assertEquals(normalizeCurrencyCode("$1,200"), "USD");
  assertEquals(normalizeCurrencyCode("bitcoins"), null);
  assertEquals(normalizeCurrencyCode(""), null);
});

Deno.test("currencyMinorDigits", () => {
  assertEquals(currencyMinorDigits("RWF"), 0);
  assertEquals(currencyMinorDigits("usd"), 2);
  assertEquals(currencyMinorDigits("KWD"), 3);
  assertEquals(currencyMinorDigits("XYZ"), 2);
});

Deno.test("normalizeDecimalString: locale formats", () => {
  assertEquals(normalizeDecimalString("1,234.56"), "1234.56");
  assertEquals(normalizeDecimalString("1.234,56"), "1234.56");
  assertEquals(normalizeDecimalString("1 234,56"), "1234.56");
  assertEquals(normalizeDecimalString("1'234.56"), "1234.56");
  assertEquals(normalizeDecimalString("500 000"), "500000");
  assertEquals(normalizeDecimalString("141,600"), "141600");
  assertEquals(normalizeDecimalString("RWF 120,000"), "120000");
  assertEquals(normalizeDecimalString("(1,234.56)"), "-1234.56");
  assertEquals(normalizeDecimalString("-42"), "-42");
  assertEquals(normalizeDecimalString("0.00"), "0.00");
  assertEquals(normalizeDecimalString("abc"), null);
});

Deno.test("decimalStringToMinor: exact, half-up, currency-aware", () => {
  assertEquals(decimalStringToMinor("120000", "RWF"), "120000");
  assertEquals(decimalStringToMinor("1250.50", "USD"), "125050");
  assertEquals(decimalStringToMinor("1.005", "USD"), "101"); // half-up at the boundary
  assertEquals(decimalStringToMinor("1.004", "USD"), "100");
  assertEquals(decimalStringToMinor("-5.00", "EUR"), "-500");
  assertEquals(decimalStringToMinor("0", "USD"), "0");
});

Deno.test("normalizeMoneyToMinor: raw + hint", () => {
  assertEquals(normalizeMoneyToMinor("141,600", "RWF"), { minor: "141600", currency: "RWF" });
  assertEquals(normalizeMoneyToMinor("$1,250.50", null), { minor: "125050", currency: "USD" });
  assertEquals(normalizeMoneyToMinor("1.234,56", "EUR"), { minor: "123456", currency: "EUR" });
  assertEquals(normalizeMoneyToMinor("nope", "RWF"), null);
  assertEquals(normalizeMoneyToMinor("100", null), null); // no currency anywhere
});

Deno.test("normalizeDate: formats + disambiguation", () => {
  assertEquals(normalizeDate("2026-08-12"), "2026-08-12");
  assertEquals(normalizeDate("12/08/2026"), "2026-08-12"); // DD/MM default
  assertEquals(normalizeDate("13/08/2026"), "2026-08-13"); // 13 can't be a month
  assertEquals(normalizeDate("08/13/2026"), "2026-08-13"); // MM/DD forced
  assertEquals(normalizeDate("12 Aug 2026"), "2026-08-12");
  assertEquals(normalizeDate("Aug 12, 2026"), "2026-08-12");
  assertEquals(normalizeDate("12/08/26"), "2026-08-12");
  assertEquals(normalizeDate("01/01/99"), "1999-01-01");
  assertEquals(normalizeDate("20260812"), "2026-08-12");
  assertEquals(normalizeDate("32/01/2026"), null);
  assertEquals(normalizeDate("not a date"), null);
});

Deno.test("normalizeTaxRate", () => {
  assertEquals(normalizeTaxRate("18%"), "18");
  assertEquals(normalizeTaxRate("VAT 18 %"), "18");
  assertEquals(normalizeTaxRate("0.18"), "18");
  assertEquals(normalizeTaxRate("7.5"), "7.5");
  assertEquals(normalizeTaxRate("250"), null);
  assertEquals(normalizeTaxRate("-1"), null);
});

Deno.test("normalizeSupplierName: comparison key", () => {
  assertEquals(normalizeSupplierName("Kigali Office Supplies Ltd"), "kigali office supplies");
  assertEquals(normalizeSupplierName("ACME, Inc."), "acme");
  assertEquals(normalizeSupplierName("Béta Sàrl"), "beta");
  assertEquals(normalizeSupplierName("   "), null);
});
