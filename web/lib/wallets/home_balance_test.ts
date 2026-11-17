import { assertEquals } from "jsr:@std/assert@1";
import { combineHomeBalance } from "./home-balance.ts";

const w = (
  name: string,
  amountMinor: bigint | null,
  asOf: string | null,
  currency = "RWF",
  basis: "provider_reported" | "manual" | null = amountMinor === null ? null : "provider_reported",
) => ({ name, currency, amountMinor, asOf, basis });

Deno.test("two wallets: the total, labelled as all of them, dated by the OLDEST figure", () => {
  const b = combineHomeBalance([
    w("MTN MoMo (Primary)", 33_140n, "2026-11-17T08:35:00Z"),
    w("Equity Bank", 32_900n, "2026-11-15T17:54:00Z"),
  ]);
  assertEquals(b, { amountRwf: 66_040, asOfIso: "2026-11-15T17:54:00Z", label: "All 2 wallets", walletCount: 2, excludedCount: 0 });
});

Deno.test("one wallet with a number: that wallet's own name, not a hard-coded one", () => {
  const b = combineHomeBalance([w("Equity Bank", 32_900n, "2026-11-15T17:54:00Z"), w("Access Bank", null, null)]);
  assertEquals(b?.label, "Equity Bank");
  assertEquals(b?.walletCount, 1);
  assertEquals(b?.excludedCount, 1); // the wallet with no balance is counted out, not as zero
});

Deno.test("a wallet with no balance is never counted as 0", () => {
  const b = combineHomeBalance([w("MTN", 100n, "2026-11-17T00:00:00Z"), w("Access", null, null)]);
  assertEquals(b?.amountRwf, 100);
});

Deno.test("no RWF wallet has a number: null, so the caller keeps its old behaviour", () => {
  assertEquals(combineHomeBalance([]), null);
  assertEquals(combineHomeBalance([w("Access", null, null)]), null);
  assertEquals(combineHomeBalance([w("USD wallet", 2_500n, "2026-11-17T00:00:00Z", "USD")]), null);
});

Deno.test("never adds across currencies", () => {
  const b = combineHomeBalance([w("MTN", 1_000n, "2026-11-17T00:00:00Z"), w("USD wallet", 2_500n, "2026-11-17T00:00:00Z", "USD")]);
  assertEquals(b?.amountRwf, 1_000);
  assertEquals(b?.walletCount, 1);
});

Deno.test("negative balances stay negative", () => {
  assertEquals(combineHomeBalance([w("MTN", -500n, "2026-11-17T00:00:00Z")])?.amountRwf, -500);
});

Deno.test("a balance someone typed in is left out of Home's total, and counted as excluded", () => {
  const b = combineHomeBalance([
    w("MTN", 33_140n, "2026-11-17T08:35:00Z"),
    w("Access Bank", 78_900n, "2026-11-16T10:00:00Z", "RWF", "manual"),
  ]);
  assertEquals(b?.amountRwf, 33_140);
  assertEquals(b?.walletCount, 1);
  assertEquals(b?.excludedCount, 1);
  // Only typed figures: nothing to show, so Home keeps its old behaviour.
  assertEquals(combineHomeBalance([w("Access Bank", 78_900n, "2026-11-16T10:00:00Z", "RWF", "manual")]), null);
});
