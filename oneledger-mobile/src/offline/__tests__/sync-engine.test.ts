import { applyServerPage, getLocalTransaction, listLocalTransactions, recordManualTransaction, getCursor, resetCursor } from "../local-store";
import { discardRejected, retryHeld, summarizeOutbox } from "../outbox";
import { TransportError } from "../retry";
import { runSync, TX_STREAM, PAGE_SIZE } from "../sync-engine";
import { openTestDb } from "../test-db";
import { ACCOUNT, args, FakeServer, serverTx } from "../test-fixtures";

const NOW = Date.parse("2026-11-17T09:30:00Z");

async function setup() {
  const { db } = await openTestDb();
  const server = new FakeServer();
  const sync = (over = {}) => runSync({ db, transport: server, now: () => NOW, random: () => 0.5, ...over });
  const record = (n: string, over = {}) =>
    recordManualTransaction(db, { args: args(over), account: ACCOUNT, transactionId: `tx-${n}`, opId: `op-${n}`, nowIso: "2026-11-17T08:00:00Z" });
  return { db, server, sync, record };
}

describe("offline create", () => {
  it("is durable and shown as pending, with the outbox row written in the same transaction", async () => {
    const { db, record } = await setup();
    await record("1");
    const tx = await getLocalTransaction(db, "tx-1");
    expect(tx).toMatchObject({ sync_state: "pending", amount_rwf: 4200, principal_effect_rwf: -4200, fee_effect_rwf: -100, source: "manual" });
    expect(await summarizeOutbox(db)).toMatchObject({ pending: 1 });
  });

  it("leaves neither a row nor an outbox entry if the write fails halfway", async () => {
    const { db } = await setup();
    await recordManualTransaction(db, { args: args(), account: ACCOUNT, transactionId: "tx-1", opId: "op-1", nowIso: "x" });
    // Same op_id again: the outbox insert violates its primary key AFTER the txn insert succeeded.
    await expect(
      recordManualTransaction(db, { args: args(), account: ACCOUNT, transactionId: "tx-2", opId: "op-1", nowIso: "x" }),
    ).rejects.toThrow();
    expect(await getLocalTransaction(db, "tx-2")).toBeNull();
  });
});

describe("push", () => {
  it("uploads, marks synced and empties the outbox", async () => {
    const { db, server, sync, record } = await setup();
    await record("1");
    const report = await sync();
    expect(report).toMatchObject({ pushed: 1, stoppedFor: null });
    expect((await getLocalTransaction(db, "tx-1"))?.sync_state).toBe("synced");
    expect(await summarizeOutbox(db)).toEqual({ pending: 0, inFlight: 0, retrying: 0, needsAttention: 0, conflicts: 0 });
    expect(server.rows).toHaveLength(1);
  });

  it("does not duplicate when the response is lost and the op is redelivered", async () => {
    const { db, server, sync, record } = await setup();
    await record("1");
    server.applyFaults = ["lose_response"];
    expect((await sync()).stoppedFor).toBe("offline"); // server applied it; client never heard
    expect(server.rows).toHaveLength(1);
    expect((await getLocalTransaction(db, "tx-1"))?.sync_state).toBe("pending");
    const report = await sync({ ignoreBackoff: true });
    expect(report.replayed).toBe(1);
    expect(server.rows).toHaveLength(1); // still exactly one
    expect((await getLocalTransaction(db, "tx-1"))?.sync_state).toBe("synced");
    expect(await listLocalTransactions(db)).toHaveLength(1); // the pull did not add a second copy
  });

  it("recovers an operation stranded in_flight by a crash, without duplicating", async () => {
    const { db, server, sync, record } = await setup();
    await record("1");
    await db.run("UPDATE outbox SET state = 'in_flight'");
    await db.run("UPDATE transactions SET sync_state = 'syncing'");
    await sync();
    expect(server.rows).toHaveLength(1);
    expect((await getLocalTransaction(db, "tx-1"))?.sync_state).toBe("synced");
  });

  it("stops at the first network failure without counting an attempt, preserving order", async () => {
    const { db, server, sync, record } = await setup();
    await record("1");
    await record("2");
    server.applyFaults = [new TransportError("network", "network_unreachable")];
    const report = await sync();
    expect(report.stoppedFor).toBe("offline");
    expect(server.calls).toEqual(["op-1"]); // op-2 was not attempted out of order
    const op = await db.get<{ attempts: number }>("SELECT attempts FROM outbox WHERE op_id = 'op-1'");
    expect(op?.attempts).toBe(0);
    await sync({ ignoreBackoff: true });
    expect(server.rows.map((r) => r.id)).toEqual(["tx-1", "tx-2"]);
  });

  it("backs off on server errors and honours the retry timer", async () => {
    const { db, server, sync, record } = await setup();
    await record("1");
    server.applyFaults = [new TransportError("server", "server_503")];
    await sync();
    expect((await summarizeOutbox(db)).retrying).toBe(1);
    server.calls.length = 0;
    await sync(); // timer not yet due (random 0.5 * 4s)
    expect(server.calls).toHaveLength(0);
    await sync({ now: () => NOW + 60 * 60_000 });
    expect((await getLocalTransaction(db, "tx-1"))?.sync_state).toBe("synced");
  });

  it("stalls (does not discard) after bounded server failures; user retry recovers it", async () => {
    const { db, server, sync, record } = await setup();
    await record("1");
    server.applyFaults = Array(20).fill(new TransportError("server", "server_500"));
    for (let i = 0; i < 12; i++) await sync({ ignoreBackoff: true });
    expect((await summarizeOutbox(db)).needsAttention).toBe(1);
    expect(await getLocalTransaction(db, "tx-1")).toMatchObject({ sync_state: "failed", amount_rwf: 4200 });
    server.applyFaults = [];
    expect(await retryHeld(db)).toBe(1);
    await sync();
    expect((await getLocalTransaction(db, "tx-1"))?.sync_state).toBe("synced");
  });

  it("holds a permanently refused op, keeps the record, and keeps syncing later ops", async () => {
    const { db, server, sync, record } = await setup();
    await record("1");
    await record("2");
    server.applyFaults = [new TransportError("permanent", "invalid_time")];
    const report = await sync();
    expect(report).toMatchObject({ rejected: 1, pushed: 1 });
    expect(await getLocalTransaction(db, "tx-1")).toMatchObject({ sync_state: "failed", sync_error: "invalid_time" });
    expect((await getLocalTransaction(db, "tx-2"))?.sync_state).toBe("synced");
    expect(await discardRejected(db, "op-1")).toBe(true); // explicit user choice only
    expect(await getLocalTransaction(db, "tx-1")).toBeNull();
  });

  it("pauses on auth expiry without penalty and resumes after", async () => {
    const { db, server, sync, record } = await setup();
    await record("1");
    server.applyFaults = [new TransportError("auth", "auth_expired")];
    expect((await sync()).stoppedFor).toBe("auth");
    expect(await db.get("SELECT attempts FROM outbox WHERE op_id='op-1' AND attempts = 0 AND state='pending'")).not.toBeNull();
    await sync();
    expect((await getLocalTransaction(db, "tx-1"))?.sync_state).toBe("synced");
  });

  it("does not deliver an op before the op it depends on", async () => {
    const { db, server, sync, record } = await setup();
    await record("1");
    await record("2");
    await db.run("UPDATE outbox SET depends_on = 'op-2' WHERE op_id = 'op-1'");
    await sync();
    expect(server.calls).toEqual(["op-2", "op-1"]);
  });
});

describe("pull", () => {
  it("downloads incrementally, pages, and does not re-download unchanged history", async () => {
    const { db, server, sync } = await setup();
    for (let i = 0; i < PAGE_SIZE + 5; i++) {
      server.rows.push(serverTx(`s-${String(i).padStart(4, "0")}`, new Date(Date.UTC(2026, 10, 1, 0, i * 10, 0)).toISOString()));
    }
    const first = await sync();
    expect(first.pulled).toBe(PAGE_SIZE + 5);
    expect(await listLocalTransactions(db, { limit: 1000 })).toHaveLength(PAGE_SIZE + 5);
    const second = await sync();
    // Only the tail inside the 2-minute safety overlap is re-read, never history.
    expect(second.pulled).toBe(1);
    expect(await listLocalTransactions(db, { limit: 1000 })).toHaveLength(PAGE_SIZE + 5);
    const cursor = await getCursor(db, TX_STREAM);
    expect(cursor.complete).toBe(true);
  });

  it("picks up a change to an existing row and drops a merged duplicate", async () => {
    const { db, server, sync } = await setup();
    server.rows.push(serverTx("a", "2026-11-01T00:00:00.000Z"), serverTx("b", "2026-11-01T00:00:01.000Z"));
    await sync();
    server.rows = [serverTx("a", "2026-11-02T00:00:00.000Z", { category: "Food" }), serverTx("b", "2026-11-02T00:00:01.000Z", { dedupe_state: "merged" })];
    await sync();
    expect((await getLocalTransaction(db, "a"))?.category).toBe("Food");
    expect(await getLocalTransaction(db, "b")).toBeNull();
  });

  it("never overwrites a record the device still owes the server", async () => {
    const { db, server, sync, record } = await setup();
    await record("1");
    server.rows.push(serverTx("tx-1", "2026-11-17T09:00:00.000Z", { amount_rwf: 1, notes: "server copy" }));
    server.applyFaults = [new TransportError("network", "network_unreachable")];
    await sync(); // push fails (offline) -> pull is skipped, but even if it ran:
    await db.run("UPDATE outbox SET state='pending', next_attempt_at=0");
    const res = await applyServerPage(db, TX_STREAM, server.rows, "x", { advanceCursor: false });
    expect(res.skippedLocal).toBe(1);
    expect((await getLocalTransaction(db, "tx-1"))?.amount_rwf).toBe(4200);
  });

  it("survives a pull failure mid-way: cursor never passes unstored rows, next run completes", async () => {
    const { db, server, sync } = await setup();
    for (let i = 0; i < PAGE_SIZE + 5; i++) server.rows.push(serverTx(`s-${i}`, new Date(Date.UTC(2026, 10, 1, 0, 0, i)).toISOString()));
    server.pullFaults = [null, new TransportError("network", "network_unreachable")];
    const first = await sync();
    expect(first.stoppedFor).toBe("offline");
    expect((await getCursor(db, TX_STREAM)).complete).toBe(false);
    await sync();
    expect(await listLocalTransactions(db, { limit: 1000 })).toHaveLength(PAGE_SIZE + 5);
  });

  it("a reset cursor re-downloads everything but keeps unsynced local work", async () => {
    const { db, server, sync, record } = await setup();
    server.rows.push(serverTx("a", "2026-11-01T00:00:00.000Z"));
    await sync();
    await record("1");
    server.applyFaults = [new TransportError("network", "network_unreachable")];
    await sync();
    await resetCursor(db, TX_STREAM);
    expect((await getCursor(db, TX_STREAM)).complete).toBe(false);
    expect((await getLocalTransaction(db, "tx-1"))?.sync_state).toBe("pending");
  });
});

describe("single flight", () => {
  it("overlapping triggers share one run (no double upload)", async () => {
    const { server, sync, record } = await setup();
    await record("1");
    const [a, b] = await Promise.all([sync(), sync()]);
    expect(a).toBe(b);
    expect(server.calls).toEqual(["op-1"]);
  });
});
