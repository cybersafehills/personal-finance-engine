import { computeLocalBalance, describeFreshness, type BalanceTx } from "../balance";

const tx = (over: Partial<BalanceTx>): BalanceTx => ({
  id: Math.random().toString(), occurred_at: "2026-11-17T08:00:00Z", balance_after_rwf: null,
  principal_effect_rwf: 0, fee_effect_rwf: 0, settlement_state: "settled", sync_state: "synced", ...over,
});

describe("computeLocalBalance", () => {
  it("separates the provider-confirmed figure from the local estimate", () => {
    const b = computeLocalBalance([
      tx({ id: "a", occurred_at: "2026-11-16T10:00:00Z", balance_after_rwf: 50_000 }),
      tx({ id: "b", sync_state: "pending", principal_effect_rwf: -4200, fee_effect_rwf: -100 }),
    ]);
    expect(b).toMatchObject({ confirmedRwf: 50_000, pendingEffectRwf: -4300, estimatedRwf: 45_700, includesUnsynced: true, pendingCount: 1 });
  });
  it("takes the NEWEST synced balance, not the first row", () => {
    const b = computeLocalBalance([
      tx({ id: "old", occurred_at: "2026-11-01T00:00:00Z", balance_after_rwf: 1 }),
      tx({ id: "new", occurred_at: "2026-11-10T00:00:00Z", balance_after_rwf: 2 }),
    ]);
    expect(b.confirmedRwf).toBe(2);
  });
  it("counts a row once even if it appears twice, and ignores merged duplicates", () => {
    const row = tx({ id: "p", sync_state: "pending", principal_effect_rwf: -100 });
    const b = computeLocalBalance([tx({ balance_after_rwf: 1000 }), row, row, tx({ id: "m", sync_state: "pending", principal_effect_rwf: -999, dedupe_state: "merged" })]);
    expect(b.pendingEffectRwf).toBe(-100);
  });
  it("excludes refused entries from the estimate", () => {
    const b = computeLocalBalance([tx({ balance_after_rwf: 1000 }), tx({ sync_state: "failed", principal_effect_rwf: -500 })]);
    expect(b.estimatedRwf).toBe(1000);
  });
  it("gives no estimate (not a made-up zero) without a confirmed balance", () => {
    expect(computeLocalBalance([tx({ sync_state: "pending", principal_effect_rwf: -5 })]).estimatedRwf).toBeNull();
  });
});

describe("describeFreshness", () => {
  const now = Date.parse("2026-11-17T12:00:00Z");
  it("never synced", () => expect(describeFreshness({ lastSyncedAtIso: null, unsyncedCount: 0, nowMs: now }).caveat).toBe("never_synced"));
  it("includes unsynced", () => expect(describeFreshness({ lastSyncedAtIso: "2026-11-17T11:59:00Z", unsyncedCount: 2, nowMs: now }).label).toMatch(/2 changes/));
  it("stale", () => expect(describeFreshness({ lastSyncedAtIso: "2026-11-10T00:00:00Z", unsyncedCount: 0, nowMs: now }).caveat).toBe("may_be_stale"));
  it("fresh", () => expect(describeFreshness({ lastSyncedAtIso: "2026-11-17T11:00:00Z", unsyncedCount: 0, nowMs: now }).caveat).toBe("none"));
});
