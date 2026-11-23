import { changeBps, compactMoney, fillTrend, homePeriods, retainedPercent, walletTotal } from "../live-data";
import type { Wallet } from "@/features/wallets/types";

const wallet = (over: Partial<Wallet> = {}): Wallet => ({ id: "a", name: "MoMo", provider: "mtn_momo", currency: "RWF", isPrimary: true, latestTxnAt: null, balance: { status: "confirmed", amountMinor: 14416n, asOf: "2026-11-19T06:47:00Z", basis: "provider_reported", reasons: [] }, ...over });
describe("live Home accounting", () => {
  it("does not mix currencies or invent missing wallet balances", () => {
    const w = wallet();
    const total = walletTotal([w, wallet({ id: "b", balance: { ...w.balance, status: "unavailable", amountMinor: null, asOf: null } }), wallet({ id: "c", currency: "USD", balance: { ...w.balance, amountMinor: 99900n } })], "RWF");
    expect(total).toMatchObject({ amount: 14416n, complete: false, count: 2, otherCurrencies: 1 });
  });
  it("carries estimated/stale provenance and uses the oldest balance timestamp", () => {
    const w = wallet();
    const total = walletTotal([w, wallet({ id: "b", balance: { ...w.balance, status: "stale", amountMinor: 1000n, asOf: "2026-10-01T00:00:00Z" } }), wallet({ id: "c", balance: { ...w.balance, status: "estimated", amountMinor: 500n } })], "RWF");
    expect(total).toMatchObject({ amount: 15916n, complete: true, estimated: true, stale: true, asOf: "2026-10-01T00:00:00Z" });
    expect(walletTotal([], "RWF").amount).toBeNull();
  });
  it("keeps high precision and does not fabricate percentage baselines", () => {
    expect(changeBps(112500n, 100000n)).toBe(1250);
    expect(changeBps(100n, null)).toBeNull();
    expect(changeBps(100n, 0n)).toBeNull();
    expect(retainedPercent(1850000n, 720000n)).toBe(61.08);
    expect(retainedPercent(0n, 720000n)).toBeNull();
    expect(retainedPercent(100n, 125n)).toBe(-25);
    expect(compactMoney(1850000n, "RWF")).toBe("RWF 1.85M");
    expect(compactMoney(12345n, "USD")).toBe("$123.45");
  });
});
describe("time boundaries", () => {
  it("compares month to date with the same point in the prior calendar month", () => {
    expect(homePeriods(new Date("2026-11-20T10:30:00Z"))).toMatchObject({ from: "2026-10-31T22:00:00.000Z", to: "2026-11-20T10:30:00.000Z", previousFrom: "2026-09-30T22:00:00.000Z", previousTo: "2026-10-20T10:30:00.000Z", trendFrom: "2026-05-31T22:00:00.000Z" });
  });
  it("clamps comparisons across February and respects Kigali midnight", () => {
    expect(homePeriods(new Date("2026-03-31T10:30:00Z")).previousTo).toBe("2026-02-28T22:00:00.000Z");
    expect(homePeriods(new Date("2026-10-31T22:01:00Z")).from).toBe("2026-10-31T22:00:00.000Z");
  });
  it("only fills empty months inside a successfully fetched reporting range", () => {
    const points = fillTrend([{ bucketStart: "2026-11-01", moneyInMinor: 3n, moneyOutMinor: 1n, netMinor: 2n }], "2026-09-30T22:00:00Z", "2026-11-20T12:00:00Z");
    expect(points.map((p) => [p.bucketStart, p.moneyInMinor])).toEqual([["2026-10-01", 0n], ["2026-11-01", 3n]]);
  });
});
