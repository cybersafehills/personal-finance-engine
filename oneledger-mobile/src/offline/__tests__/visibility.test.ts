import { assertCachedAccess, reconcileVisibility, SHARED_LEASE_MS, type SnapshotPage } from "../visibility";
import { openTestDb } from "../test-db";
import { applyServerPage, getLocalTransaction, getCursor } from "../local-store";
import { serverTx } from "../test-fixtures";
const NOW = "2026-11-18T10:00:00.000Z";
const spaces = [{ id: "ws-1", kind: "household" }];
function page(rows: SnapshotPage["rows"]): SnapshotPage { return { rows, workspaces: spaces, server_time: NOW }; }

it("evicts deleted or revoked synced data, quarantines pending edits and renews only authorized spaces", async () => {
  const { db } = await openTestDb();
  await applyServerPage(db, "transactions", [serverTx("visible", NOW), serverTx("hidden", NOW), serverTx("pending-edit", NOW)], NOW, { advanceCursor: true });
  await db.run("UPDATE transactions SET sync_state = 'pending' WHERE id = 'pending-edit'");
  let n = 0;
  await reconcileVisibility({ db, active: () => true, fetchPage: async () => n++ === 0 ? page([serverTx("visible", NOW)]) : page([]), visibleIds: async (ids) => ids });
  expect(await getLocalTransaction(db, "hidden")).toBeNull();
  expect((await getLocalTransaction(db, "pending-edit"))?.visibility_revoked).toBe(1);
  await expect(assertCachedAccess(db, "ws-1", Date.parse(NOW) + SHARED_LEASE_MS - 1)).resolves.toBeUndefined();
  await expect(assertCachedAccess(db, "ws-1", Date.parse(NOW) + SHARED_LEASE_MS)).rejects.toThrow("Reconnect");
  await expect(assertCachedAccess(db, "removed-space", Date.parse(NOW))).rejects.toThrow("Reconnect");
});

it("does not renew on an interrupted or capped snapshot", async () => {
  const { db } = await openTestDb();
  await expect(reconcileVisibility({ db, active: () => true, maxPages: 1, fetchPage: async () => page([serverTx("visible", NOW)]), visibleIds: async (ids) => ids })).rejects.toThrow("incomplete");
  expect(await db.all("SELECT * FROM workspace_leases")).toEqual([]);
  expect((await getCursor(db, "transactions")).complete).toBe(false);
});

it("rechecks a source revoked during download, even when its Space membership remains", async () => {
  const { db } = await openTestDb();
  let n = 0;
  await reconcileVisibility({ db, active: () => true, fetchPage: async () => n++ === 0 ? page([serverTx("revoked-mid-download", NOW)]) : page([]), visibleIds: async () => [] });
  expect(await getLocalTransaction(db, "revoked-mid-download")).toBeNull();
});

it("cancels before applying a response from a previous identity", async () => {
  const { db } = await openTestDb();
  let active = true;
  await expect(reconcileVisibility({ db, active: () => active, fetchPage: async () => { active = false; return page([serverTx("old-user", NOW)]); }, visibleIds: async (ids) => ids })).rejects.toThrow("session_changed");
  expect(await getLocalTransaction(db, "old-user")).toBeNull();
  expect(await db.all("SELECT * FROM workspace_leases")).toEqual([]);
});
