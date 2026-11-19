import { selectWorkspace } from "@/features/spaces/selected-space";
import { getCurrentBalance, getTodayTotals, getTransactionById, getTransactions } from "@/features/transactions/queries";

import { applyServerPage, recordManualTransaction } from "../local-store";
import { setOfflineRuntime } from "../runtime";
import { openTestDb } from "../test-db";
import { ACCOUNT, args, serverTx } from "../test-fixtures";

// The app's read functions, running with NO network and NO supabase client:
// everything below must come from the device database.

describe("offline reads", () => {
  afterEach(() => setOfflineRuntime(null));

  async function seeded() {
    const { db } = await openTestDb();
    await applyServerPage(
      db,
      "transactions",
      [
        serverTx("old", "2026-11-16T10:00:00.000Z", { occurred_at: "2026-11-16T10:00:00.000Z", balance_after_rwf: 50_000 }),
        serverTx("in", "2026-11-17T07:00:00.000Z", { occurred_at: "2026-11-17T07:00:00.000Z", direction: "in", principal_effect_rwf: 2000, amount_rwf: 2000, balance_after_rwf: 52_000, category: "Salary" }),
      ],
      "x",
      { advanceCursor: true },
    );
    await recordManualTransaction(db, {
      args: args({ p_occurred_at: "2026-11-17T08:00:00.000Z" }), account: ACCOUNT, transactionId: "mine", opId: "op-mine", nowIso: "x",
    });
    selectWorkspace("ws-1");
    await db.run("INSERT OR REPLACE INTO workspace_leases VALUES (?,?,?,?)", ["ws-1", "personal", "2026-11-17T00:00:00Z", "2026-11-24T00:00:00Z"]);
    setOfflineRuntime({ db, userId: "u", bootstrapped: true });
    return db;
  }

  it("lists synced and pending rows together, newest first, marking what isn't confirmed", async () => {
    await seeded();
    const rows = await getTransactions({ nowIso: "2026-11-17T12:00:00.000Z" });
    expect(rows.map((r) => r.id)).toEqual(["mine", "in", "old"]);
    expect(rows[0].sync_state).toBe("pending");
    expect(rows[1].sync_state).toBe("synced");
  });

  it("filters and searches locally", async () => {
    await seeded();
    expect((await getTransactions({ q: "kigali" })).map((r) => r.id)).toEqual(["mine"]);
    expect((await getTransactions({ category: "Salary" })).map((r) => r.id)).toEqual(["in"]);
    expect((await getTransactions({ filters: { direction: "in", period: "all", needsReview: false } as never })).map((r) => r.id)).toEqual(["in"]);
  });

  it("keeps the confirmed balance separate from the unsynced effect", async () => {
    await seeded();
    const balance = await getCurrentBalance();
    expect(balance).toMatchObject({ amountRwf: 52_000, pendingEffectRwf: -4300, pendingCount: 1 });
  });

  it("includes pending entries in today's totals", async () => {
    await seeded();
    const totals = await getTodayTotals("2026-11-17T12:00:00.000Z");
    expect(totals).toMatchObject({ spentRwf: 4300, receivedRwf: 2000 });
  });

  it("reads one transaction by id", async () => {
    await seeded();
    expect((await getTransactionById("mine"))?.sync_state).toBe("pending");
    expect(await getTransactionById("nope")).toBeNull();
  });

  it("does not read the device copy until its first full download is complete", async () => {
    const { db } = await openTestDb();
    setOfflineRuntime({ db, userId: "u", bootstrapped: false });
    await expect(getTransactions()).rejects.toThrow(); // falls to the (unconfigured) server path
  });
});

it("switches local Spaces without mixing their rows or totals", async () => {
  const { db } = await openTestDb();
  await applyServerPage(db, "transactions", [serverTx("a", "2026-11-18T08:00:00Z"), serverTx("b", "2026-11-18T08:00:00Z", { workspace_id: "ws-2" })], "2026-11-18T08:00:00Z", { advanceCursor: true });
  await db.run("INSERT INTO workspace_leases VALUES ('ws-1','personal','2026-11-18','2026-11-25')");
  await db.run("INSERT INTO workspace_leases VALUES ('ws-2','personal','2026-11-18','2026-11-25')");
  setOfflineRuntime({ db, userId: "u", bootstrapped: true });
  selectWorkspace("ws-1"); expect((await getTransactions()).map((r) => r.id)).toEqual(["a"]);
  selectWorkspace("ws-2"); expect((await getTransactions()).map((r) => r.id)).toEqual(["b"]);
  expect(await getTransactionById("a")).toBeNull();
  setOfflineRuntime(null);
});
