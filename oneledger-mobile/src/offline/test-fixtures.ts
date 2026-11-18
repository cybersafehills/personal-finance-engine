import type { ManualAccount, ManualTransactionArgs } from "@/features/manual/input";

import type { ServerTransaction } from "./local-store";
import type { OutboxOp } from "./outbox";
import { TransportError } from "./retry";
import type { SyncTransport } from "./sync-engine";

export const ACCOUNT: ManualAccount = { id: "acct-1", name: "MoMo", workspaceId: "ws-1", currency: "RWF" };

export function args(over: Partial<ManualTransactionArgs> = {}): ManualTransactionArgs {
  return {
    p_account_id: ACCOUNT.id,
    p_transaction_type: "merchant_payment",
    p_direction: "out",
    p_amount_minor: 4200,
    p_fee_minor: 100,
    p_occurred_at: "2026-11-17T08:00:00.000Z",
    p_counterparty_name: "Kigali Fresh",
    p_notes: null,
    ...over,
  };
}

export function serverTx(id: string, updatedAt: string, over: Partial<ServerTransaction> = {}): ServerTransaction {
  return {
    id, account_id: ACCOUNT.id, workspace_id: ACCOUNT.workspaceId, source: "mtn_momo", transaction_type: "send_money",
    direction: "out", status: "success", currency: "RWF", amount_rwf: 1000, fee_rwf: 0,
    principal_effect_rwf: -1000, fee_effect_rwf: 0, settlement_state: "settled", balance_after_rwf: 50_000,
    counterparty_name: "Jean", counterparty_reference: null, occurred_at: updatedAt, category: null, subcategory: null,
    category_decision_status: "uncategorized", suggested_category: null, dedupe_state: "unique", notes: null,
    updated_at: updatedAt, ...over,
  };
}

/** A fake server with real idempotency semantics, plus failure injection. */
export class FakeServer implements SyncTransport {
  applied = new Map<string, { entityId: string; serverUpdatedAt: string }>(); // op_id -> result
  rows: ServerTransaction[] = [];
  calls: string[] = [];
  /** Queue of errors (or null = succeed) to inject on successive applyOp calls. */
  applyFaults: (TransportError | "lose_response" | null)[] = [];
  pullFaults: (TransportError | null)[] = [];
  clock = 1;

  async applyOp(op: OutboxOp) {
    this.calls.push(op.op_id);
    const fault = this.applyFaults.shift() ?? null;
    if (fault instanceof TransportError) throw fault;
    if (op.op_type === "set_category") {
      const p = JSON.parse(op.payload);
      const existing = this.applied.get(op.op_id);
      if (existing) return { status: "replayed" as const, serverUpdatedAt: existing.serverUpdatedAt };
      const row = this.rows.find((r) => r.id === p.transaction_id);
      if (!row) throw new TransportError("permanent", "not_found_or_forbidden");
      const cur = { category: row.category, subcategory: row.subcategory };
      const same = cur.category === p.category && cur.subcategory === p.subcategory;
      if (!p.force && !same && (cur.category !== p.base_category || cur.subcategory !== p.base_subcategory)) {
        return { status: "conflict" as const, server: cur };
      }
      row.category = p.category;
      row.subcategory = p.subcategory;
      row.updated_at = new Date(Date.UTC(2026, 10, 17, 9, 1, this.clock++)).toISOString();
      this.applied.set(op.op_id, { entityId: row.id, serverUpdatedAt: row.updated_at });
      if (fault === "lose_response") throw new TransportError("network", "network_unreachable");
      return { status: "applied" as const, serverUpdatedAt: row.updated_at };
    }
    const existing = this.applied.get(op.op_id);
    let status: "applied" | "replayed" = "replayed";
    if (!existing) {
      const p = JSON.parse(op.payload);
      const updated = new Date(Date.UTC(2026, 10, 17, 9, 0, this.clock++)).toISOString();
      this.applied.set(op.op_id, { entityId: op.entity_id, serverUpdatedAt: updated });
      this.rows.push(serverTx(op.entity_id, updated, { source: "manual", amount_rwf: p.p_amount_minor, balance_after_rwf: null, principal_effect_rwf: -p.p_amount_minor }));
      status = "applied";
    }
    if (fault === "lose_response") throw new TransportError("network", "network_unreachable");
    return { status, serverUpdatedAt: this.applied.get(op.op_id)!.serverUpdatedAt };
  }
  async fetchChanges(after: { updatedAt: string | null; id: string | null }, limit: number) {
    const fault = this.pullFaults.shift() ?? null;
    if (fault) throw fault;
    return this.rows
      .filter((r) => !after.updatedAt || r.updated_at > after.updatedAt || (r.updated_at === after.updatedAt && after.id !== null && r.id > after.id))
      .sort((a, b) => (a.updated_at === b.updated_at ? (a.id < b.id ? -1 : 1) : a.updated_at < b.updated_at ? -1 : 1))
      .slice(0, limit);
  }
  async fetchAccounts() {
    return [ACCOUNT];
  }
}
