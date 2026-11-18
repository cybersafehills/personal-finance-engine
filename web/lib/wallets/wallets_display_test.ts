import { assertEquals } from "jsr:@std/assert@1";
import {
  parseBalanceInput,
  STATUS_LABEL,
  totalsByCurrency,
} from "./wallets-display.ts";

Deno.test("balance input: whole RWF, grouping, zero", () => {
  assertEquals(parseBalanceInput("78,900", "RWF"), {
    ok: true,
    amountMinor: 78900n,
  });
  assertEquals(parseBalanceInput(" 78 900 ", "RWF"), {
    ok: true,
    amountMinor: 78900n,
  });
  assertEquals(parseBalanceInput("0", "RWF"), { ok: true, amountMinor: 0n });
  assertEquals(parseBalanceInput("78900.00", "RWF"), {
    ok: true,
    amountMinor: 78900n,
  });
});

Deno.test("balance input: never rounds, never guesses", () => {
  // RWF has no cents: a fraction is refused, not rounded.
  assertEquals(parseBalanceInput("78900.5", "RWF").ok, false);
  // 2-decimal currency: exact cents only.
  assertEquals(parseBalanceInput("78,900.5", "USD"), {
    ok: true,
    amountMinor: 7890050n,
  });
  assertEquals(parseBalanceInput("12", "EUR"), {
    ok: true,
    amountMinor: 1200n,
  });
  assertEquals(parseBalanceInput("12.340", "EUR"), {
    ok: true,
    amountMinor: 1234n,
  });
  assertEquals(parseBalanceInput("12.345", "EUR").ok, false);
  for (const bad of ["", "abc", "-5", "1e3", "12.", ".5", "1.2.3", "٣٤"]) {
    assertEquals(parseBalanceInput(bad, "RWF").ok, false, bad);
  }
  // Unknown decimal places: refused with a reason.
  assertEquals(parseBalanceInput("100", "KES"), {
    ok: false,
    error: "Balances in KES can't be entered yet.",
  });
  // Stays inside what a JSON number / bigint column can hold exactly.
  assertEquals(parseBalanceInput("999999999999999", "RWF").ok, true);
  assertEquals(parseBalanceInput("1000000000000000", "RWF").ok, false);
  // The bound is on minor units, so cents cannot push a value past 2^53.
  assertEquals(parseBalanceInput("9999999999999.99", "USD").ok, true);
  assertEquals(parseBalanceInput("99999999999999.99", "USD").ok, false);
});

Deno.test("totals: per currency, uncertainty carried, unavailable excluded", () => {
  const t = totalsByCurrency([
    { currency: "RWF", status: "confirmed", amountMinor: 50000n },
    { currency: "RWF", status: "estimated", amountMinor: 20000n },
    { currency: "RWF", status: "stale", amountMinor: 1000n },
    { currency: "RWF", status: "unavailable", amountMinor: null },
    { currency: "USD", status: "confirmed", amountMinor: 2500n },
    { currency: "EUR", status: "unavailable", amountMinor: null },
  ]);
  assertEquals(t, [
    {
      currency: "EUR",
      totalMinor: 0n,
      counted: 0,
      unavailable: 1,
      allConfirmed: false,
      uncertain: 0,
    },
    {
      currency: "RWF",
      totalMinor: 71000n,
      counted: 3,
      unavailable: 1,
      allConfirmed: false,
      uncertain: 2,
    },
    {
      currency: "USD",
      totalMinor: 2500n,
      counted: 1,
      unavailable: 0,
      allConfirmed: true,
      uncertain: 0,
    },
  ]);
});

Deno.test("labels match the mobile app's words", () => {
  assertEquals(STATUS_LABEL, {
    confirmed: "Confirmed",
    estimated: "Estimated",
    stale: "Out of date",
    unavailable: "Not available",
  });
});

Deno.test("updateHint: every state says how the balance gets (or stays) current", async () => {
  const { updateHint } = await import("./wallets-display.ts");
  assertEquals(
    updateHint(null, false).startsWith("To get a balance here"),
    true,
  );
  assertEquals(
    updateHint("manual", true).startsWith("You entered this balance"),
    true,
  );
  assertEquals(
    updateHint("provider_reported", true).startsWith("Updates by itself"),
    true,
  );
});
