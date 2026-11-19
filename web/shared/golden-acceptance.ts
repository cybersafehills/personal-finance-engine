import type { FinancialRow } from "./financial.ts";
import vectors from "./financial-fixtures.json" with { type: "json" };

/** Disposable, synthetic acceptance facts, never production records. Adapters
 * must seed these facts through actual authorized APIs; this is not an RLS
 * simulator or evidence that HTTP/device integration has run. */
export function goldenAcceptance(repeatedCount = 20001) {
  const id = (n: number) =>
    `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const spaces = [{ id: id(1), kind: "personal" }, {
    id: id(2),
    kind: "household",
  }];
  const users = ["owner", "member", "viewer", "removed"].map((role, i) => ({
    id: id(i + 10),
    role,
    workspaceId: spaces[1].id,
    active: role !== "removed",
  }));
  const wallets = ["RWF", "USD", "EUR", "RWF", "RWF"].map((currency, i) => ({
    id: id(i + 20),
    currency,
    workspaceId: spaces[i === 3 ? 1 : 0].id,
    sourceId: id(i + 30),
  }));
  const sources = wallets.map((w, i) => ({
    id: w.sourceId,
    ownerId: users[0].id,
    visibility: i === 3 ? "shared" : "private",
    workspaceId: w.workspaceId,
  }));
  const rows: (FinancialRow & {
    workspace_id: string;
    account_id: string;
    occurred_at: string;
    category?: string;
  })[] = vectors.rows.map((r, i) => ({
    ...r,
    id: id(100 + i),
    workspace_id: spaces[0].id,
    account_id: wallets[
      r.id === "transfer-in"
        ? 4
        : r.currency === "USD"
        ? 1
        : r.currency === "EUR"
        ? 2
        : 0
    ].id,
    occurred_at: "2026-11-18T10:00:00Z",
  }));
  // Household RWF spending lands exactly at Kigali midnight; a separate row
  // immediately before it exercises half-open period boundaries.
  for (let i = 0; i < repeatedCount; i++) {
    rows.push({
      id: id(1000 + i),
      currency: "RWF",
      direction: "out",
      principal_effect_rwf: -1,
      fee_effect_rwf: 0,
      settlement_state: "settled",
      workspace_id: spaces[1].id,
      account_id: wallets[3].id,
      occurred_at: "2026-11-17T22:00:00Z",
      category: "Food",
    });
  }
  const boundaryBefore = {
    ...rows[rows.length - 1],
    id: id(999999),
    occurred_at: "2026-11-17T21:59:59.999Z",
  };
  return {
    spaces,
    users,
    sources,
    wallets,
    rows,
    boundaryBefore,
    transferLinks: [{
      workspaceId: spaces[0].id,
      outTransactionId: rows[2].id,
      inTransactionId: rows[3].id,
      status: "linked",
    }],
    selfCounterparties: [{
      id: id(60),
      workspaceId: spaces[0].id,
      kind: "self",
      transactionIds: [rows[4].id],
    }],
    period: {
      timezone: "Africa/Kigali",
      startUtc: "2026-11-17T22:00:00Z",
      endExclusiveUtc: "2026-11-18T22:00:00Z",
    },
    splits: [{
      transactionId: rows[1].id,
      categories: [{ key: "Food", minor: 700 }, {
        key: "Transport",
        minor: 550,
      }],
    }],
    budget: {
      workspaceId: spaces[1].id,
      currency: "RWF",
      allocationMinor: 25000,
      expectedActualMinor: repeatedCount,
    },
    goal: {
      workspaceId: spaces[1].id,
      currency: "RWF",
      targetMinor: 50000,
      savedMinor: 10000,
    },
    revocation: {
      userId: users[1].id,
      sourceId: sources[3].id,
      expectedVisibleAfter: [] as string[],
    },
    expectedPersonal: vectors.expected,
    expectedHousehold: [{
      currency: "RWF",
      sentMinor: repeatedCount,
      receivedMinor: 0,
      count: repeatedCount,
    }],
  };
}
