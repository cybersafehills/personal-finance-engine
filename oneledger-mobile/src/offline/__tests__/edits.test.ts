import { getLocalTransaction, setCategoryLocally } from "../local-store";
import { discardRejected, listOutboxEntries, resolveConflict, summarizeOutbox } from "../outbox";
import { TransportError } from "../retry";
import { runSync } from "../sync-engine";
import { openTestDb } from "../test-db";
import { FakeServer, serverTx } from "../test-fixtures";

const NOW = Date.parse("2026-11-17T09:30:00Z");

async function setup() {
  const { db } = await openTestDb();
  const server = new FakeServer();
  server.rows.push(serverTx("t1", "2026-11-16T00:00:00.000Z", { category: "Food", subcategory: null }));
  const sync = (over = {}) => runSync({ db, transport: server, now: () => NOW, random: () => 0.5, ...over });
  await sync(); // first download
  await db.run("INSERT INTO workspace_leases VALUES (?,?,?,?)", ["ws-1", "personal", "2026-11-17T00:00:00Z", "2026-11-24T00:00:00Z"]);
  const edit = (n: string, category: string, sub: string | null = null) =>
    setCategoryLocally(db, { transactionId: "t1", category, subcategory: sub, opId: `e${n}`, nowIso: "x" });
  return { db, server, sync, edit };
}

describe("offline category edit", () => {
  it("shows immediately, is marked unsynced, then syncs and the server has it", async () => {
    const { db, server, sync, edit } = await setup();
    await edit("1", "Transport");
    expect(await getLocalTransaction(db, "t1")).toMatchObject({ category: "Transport", sync_state: "pending", category_decision_status: "confirmed" });
    await sync();
    expect(server.rows[0].category).toBe("Transport");
    expect((await getLocalTransaction(db, "t1"))?.sync_state).toBe("synced");
  });

  it("is not overwritten by a pull while the edit is waiting", async () => {
    const { db, server, sync, edit } = await setup();
    await edit("1", "Transport");
    server.applyFaults = [new TransportError("network", "network_unreachable")];
    server.rows[0].updated_at = "2026-11-17T08:00:00.000Z"; // server row changes (e.g. enrichment)
    await sync();
    expect((await getLocalTransaction(db, "t1"))?.category).toBe("Transport");
  });

  it("does not double-apply when the response is lost", async () => {
    const { server, sync, edit } = await setup();
    await edit("1", "Transport");
    server.applyFaults = ["lose_response"];
    await sync();
    await sync({ ignoreBackoff: true });
    expect(server.rows[0].category).toBe("Transport");
    expect([...server.applied.keys()].filter((k) => k === "e1")).toHaveLength(1);
  });

  it("two queued edits to one record arrive in order", async () => {
    const { server, sync, edit } = await setup();
    await edit("1", "Transport");
    await edit("2", "Fuel");
    await sync();
    expect(server.rows[0].category).toBe("Fuel");
  });

  it("detects a conflicting change made elsewhere and changes nothing", async () => {
    const { db, server, sync, edit } = await setup();
    await edit("1", "Transport");
    server.rows[0].category = "Groceries"; // changed on another device meanwhile
    const report = await sync();
    expect(report.conflicts).toBe(1);
    expect(server.rows[0].category).toBe("Groceries");
    expect(await getLocalTransaction(db, "t1")).toMatchObject({ category: "Transport", sync_state: "conflict" });
    const [entry] = await listOutboxEntries(db);
    expect(entry.conflict).toEqual({ mine: { category: "Transport", subcategory: null }, server: { category: "Groceries", subcategory: null } });
    expect((await summarizeOutbox(db)).conflicts).toBe(1);
  });

  it("holds later edits behind a conflict, then keep_mine re-sends and wins", async () => {
    const { db, server, sync, edit } = await setup();
    await edit("1", "Transport");
    await edit("2", "Fuel");
    server.rows[0].category = "Groceries";
    await sync();
    expect(server.calls.filter((c) => c === "e2")).toHaveLength(0); // e2 waits behind the conflicted e1
    expect(await resolveConflict(db, "e1", "keep_mine")).toBe(true);
    await sync({ ignoreBackoff: true });
    expect(server.rows[0].category).toBe("Fuel");
    expect((await getLocalTransaction(db, "t1"))?.sync_state).toBe("synced");
  });

  it("use_server adopts the server value locally and drops the edit", async () => {
    const { db, server, sync, edit } = await setup();
    await edit("1", "Transport");
    server.rows[0].category = "Groceries";
    await sync();
    expect(await resolveConflict(db, "e1", "use_server")).toBe(true);
    expect(await getLocalTransaction(db, "t1")).toMatchObject({ category: "Groceries", sync_state: "synced" });
    expect((await summarizeOutbox(db)).conflicts).toBe(0);
    expect(server.rows[0].category).toBe("Groceries");
  });

  it("applies cleanly when the server already holds the wanted value", async () => {
    const { server, sync, edit } = await setup();
    await edit("1", "Transport");
    server.rows[0].category = "Transport";
    expect((await sync()).conflicts).toBe(0);
  });

  it("rejects an invalid or unknown edit locally without queueing", async () => {
    const { db, edit } = await setup();
    await expect(edit("1", "  ")).rejects.toThrow();
    await expect(setCategoryLocally(db, { transactionId: "nope", category: "X", subcategory: null, opId: "z", nowIso: "x" })).rejects.toThrow();
    expect((await summarizeOutbox(db)).pending).toBe(0);
  });
});

describe("refused edit and upgrade safety", () => {
  it("discarding a refused category edit restores the old category and keeps the transaction", async () => {
    const { db, server, sync, edit } = await setup();
    await edit("1", "Transport");
    server.applyFaults = [new TransportError("permanent", "not_found_or_forbidden")];
    await sync();
    expect((await getLocalTransaction(db, "t1"))?.sync_state).toBe("failed");
    
    expect(await discardRejected(db, "e1")).toBe(true);
    expect(await getLocalTransaction(db, "t1")).toMatchObject({ category: "Food", sync_state: "synced" });
  });
});
