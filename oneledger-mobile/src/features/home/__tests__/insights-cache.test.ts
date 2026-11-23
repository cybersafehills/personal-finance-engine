import { mergeInsights, reviveInsights, serializeInsights, type HomeInsights } from "../insights-cache";

const block = (income: bigint) => ({ ok: true as const, workspaceId: "w1", overview: { from: "a", to: "b", latestTxnAt: null, skippedCurrencies: 0, currencies: [{ currency: "RWF", moneyInMinor: income, moneyOutMinor: 5n, netMinor: income - 5n, cashOutMinor: 0n, countIn: 1, countOut: 1, transfersExcluded: { amountMinor: 0n, count: 0 }, pending: { amountMinor: 0n, count: 0 }, byCategory: [], topPeople: [], compare: null, drilldowns: {}, trend: [] }] } }) as never;
const failed = { ok: false as const, reason: "error" as const, message: "x" } as never;
const snapshot = (at: string, today: unknown = block(7n)): HomeInsights => ({ current: block(100n), previous: block(90n), today: today as never, periods: {} as never, fetchedAt: at });
const now = new Date("2026-11-23T10:00:00Z");
const todayAmount = (v: HomeInsights) => (v.today as never as { overview: { currencies: { moneyInMinor: bigint }[] } }).overview.currencies[0].moneyInMinor;

it("round-trips bigint amounts exactly", () => {
  const back = reviveInsights(serializeInsights(snapshot("2026-11-23T08:00:00Z")))!;
  expect(todayAmount(back)).toBe(7n);
  expect((back.current as never as { overview: { currencies: { moneyInMinor: bigint }[] } }).overview.currencies[0].moneyInMinor).toBe(100n);
});
it("rejects malformed or foreign cache text", () => {
  expect(reviveInsights("not json")).toBeNull();
  expect(reviveInsights('{"a":1}')).toBeNull();
});
it("shows remembered numbers immediately and fresh ones once they arrive", () => {
  const remembered = snapshot("2026-11-23T08:00:00Z");
  const first = mergeInsights(null, remembered, now);
  expect(first.usingRemembered).toBe(true);
  expect(first.todayPending).toBe(false);
  expect(todayAmount(first.data!)).toBe(7n);
  const next = mergeInsights(snapshot("2026-11-23T10:00:00Z", block(9n)), remembered, now);
  expect(next.usingRemembered).toBe(false);
  expect(todayAmount(next.data!)).toBe(9n);
});
it("never presents yesterday's 'today' as today's", () => {
  const first = mergeInsights(null, snapshot("2026-11-22T20:00:00Z"), now);
  expect(first.todayPending).toBe(true);
  expect(first.data!.current.ok).toBe(true);
});
it("keeps a remembered same-day block when the fresh one failed", () => {
  const merged = mergeInsights(snapshot("2026-11-23T10:00:00Z", failed), snapshot("2026-11-23T08:00:00Z"), now);
  expect(merged.data!.today.ok).toBe(true);
});
