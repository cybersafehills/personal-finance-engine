import { supabase } from "@/api/supabase";
import { listManualAccounts } from "@/features/manual/actions";

import type { ServerTransaction, CreateManualPayload, SetCategoryPayload } from "./local-store";
import type { OutboxOp } from "./outbox";
import { classifyError, TransportError } from "./retry";
import type { SyncTransport } from "./sync-engine";

// The real transport: the idempotent sync RPCs under the user's own session
// (Row Level Security + server-side authorization on every call). Error
// messages are reduced to stable codes; payloads are never logged or surfaced.

function requireClient() {
  if (!supabase) throw new TransportError("permanent", "not_configured");
  return supabase;
}

async function applySetCategory(op: OutboxOp) {
  const p = JSON.parse(op.payload) as SetCategoryPayload;
  let result;
  try {
    result = await requireClient().rpc("sync_set_category", {
      p_op_id: op.op_id,
      p_transaction_id: p.transaction_id,
      p_category: p.category,
      p_subcategory: p.subcategory,
      p_base_category: p.base_category,
      p_base_subcategory: p.base_subcategory,
      p_force: p.force,
    });
  } catch {
    throw new TransportError("network", "network_unreachable");
  }
  if (result.error) {
    throw classifyError({ status: result.status, message: result.error.message, networkFailure: result.status === 0 });
  }
  const data = result.data as { status?: string; server_updated_at?: string; server?: unknown } | null;
  if (data?.status === "conflict") return { status: "conflict" as const, server: data.server };
  if (!data || (data.status !== "applied" && data.status !== "replayed")) throw new TransportError("server", "unexpected_response");
  return { status: data.status as "applied" | "replayed", serverUpdatedAt: data.server_updated_at ?? null };
}

export const supabaseTransport: SyncTransport = {
  async applyOp(op) {
    if (op.op_type === "set_category") return applySetCategory(op);
    if (op.op_type !== "create_manual_transaction") throw new TransportError("permanent", "unsupported_operation");
    const p = JSON.parse(op.payload) as CreateManualPayload;
    let result;
    try {
      result = await requireClient().rpc("sync_create_manual_transaction", {
        p_op_id: op.op_id,
        p_id: p.transaction_id,
        p_account_id: p.p_account_id,
        p_transaction_type: p.p_transaction_type,
        p_direction: p.p_direction,
        p_amount_minor: p.p_amount_minor,
        p_fee_minor: p.p_fee_minor,
        p_occurred_at: p.p_occurred_at,
        p_counterparty_name: p.p_counterparty_name,
        p_notes: p.p_notes,
      });
    } catch {
      throw new TransportError("network", "network_unreachable");
    }
    if (result.error) {
      throw classifyError({ status: result.status, message: result.error.message, code: result.error.code, networkFailure: result.status === 0 });
    }
    const data = result.data as { status?: string; server_updated_at?: string } | null;
    if (!data || (data.status !== "applied" && data.status !== "replayed")) {
      throw new TransportError("server", "unexpected_response");
    }
    return { status: data.status, serverUpdatedAt: data.server_updated_at ?? null };
  },

  async fetchChanges(after, limit) {
    let result;
    try {
      result = await requireClient().rpc("sync_transactions_changes", {
        p_after_updated_at: after.updatedAt,
        p_after_id: after.id,
        p_limit: limit,
      });
    } catch {
      throw new TransportError("network", "network_unreachable");
    }
    if (result.error) {
      throw classifyError({ status: result.status, message: result.error.message, networkFailure: result.status === 0 });
    }
    return (result.data ?? []) as ServerTransaction[];
  },

  async fetchAccounts() {
    try {
      return await listManualAccounts();
    } catch (error) {
      throw classifyError({ message: error instanceof Error ? error.message : "" });
    }
  },
};
