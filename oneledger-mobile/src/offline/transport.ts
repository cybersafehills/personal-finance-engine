import { supabase } from "@/api/supabase";
import { createClient } from "@supabase/supabase-js";
import { config } from "@/lib/config";
import type { ManualAccount } from "@/features/manual/input";
import { isCurrency, completePages } from "../../../web/shared/financial";
import type { SnapshotPage } from "./visibility";

import type { ServerTransaction, CreateManualPayload, SetCategoryPayload } from "./local-store";
import type { OutboxOp } from "./outbox";
import { classifyError, TransportError } from "./retry";
import type { SyncTransport } from "./sync-engine";

// The real transport: the idempotent sync RPCs under the user's own session
// (Row Level Security + server-side authorization on every call). Error
// messages are reduced to stable codes; payloads are never logged or surfaced.

// Never use the mutable singleton's credentials for a queued operation. Capture
// an explicitly bound bearer after checking the current identity on EVERY call.
async function userClient(userId: string) {
  if (!supabase) throw new TransportError("permanent", "not_configured");
  const { data } = await supabase.auth.getSession();
  if (!data.session || data.session.user.id !== userId) throw new TransportError("auth", "session_changed");
  return createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
  });
}

async function applySetCategory(op: OutboxOp, userId: string) {
  const p = JSON.parse(op.payload) as SetCategoryPayload;
  let result;
  try {
    result = await (await userClient(userId)).rpc("sync_set_category", {
      p_op_id: op.op_id,
      p_transaction_id: p.transaction_id,
      p_category: p.category,
      p_subcategory: p.subcategory,
      p_base_category: p.base_category,
      p_base_subcategory: p.base_subcategory,
      p_force: p.force,
    });
  } catch (error) {
    if (error instanceof TransportError) throw error;
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

export function createUserTransport(userId: string): SyncTransport { return {
  async applyOp(op) {
    if (op.op_type === "set_category") return applySetCategory(op, userId);
    if (op.op_type !== "create_manual_transaction") throw new TransportError("permanent", "unsupported_operation");
    const p = JSON.parse(op.payload) as CreateManualPayload;
    let result;
    try {
      result = await (await userClient(userId)).rpc("sync_create_manual_transaction", {
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
    } catch (error) {
      if (error instanceof TransportError) throw error;
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
      result = await (await userClient(userId)).rpc("sync_transactions_changes", {
        p_after_updated_at: after.updatedAt,
        p_after_id: after.id,
        p_limit: limit,
      });
    } catch (error) {
      if (error instanceof TransportError) throw error;
      throw new TransportError("network", "network_unreachable");
    }
    if (result.error) {
      throw classifyError({ status: result.status, message: result.error.message, networkFailure: result.status === 0 });
    }
    return (result.data ?? []) as ServerTransaction[];
  },

  async fetchAccounts() {
    const client = await userClient(userId);
    const data = await completePages<{ id: string; name: string; currency: string; workspace_id: string }>(async (offset, size) => {
      const { data, error } = await client.from("accounts").select("id,name,currency,workspace_id")
        .eq("is_active", true).is("archived_at", null).order("id").range(offset, offset + size - 1);
      if (error) throw classifyError({ message: error.message });
      return data ?? [];
    });
    return (data ?? []).filter((a) => isCurrency(a.currency)).map((a): ManualAccount => ({ id: a.id, name: a.name, currency: a.currency as ManualAccount["currency"], workspaceId: a.workspace_id }));
  },
  async fetchSnapshotPage(afterId) {
    const { data, error, status } = await (await userClient(userId)).rpc("sync_financial_snapshot_page", { p_after_id: afterId, p_limit: 200 });
    if (error) throw classifyError({ status, message: error.message, networkFailure: status === 0 });
    const page = data as SnapshotPage;
    if (!page || !Array.isArray(page.rows) || !Array.isArray(page.workspaces)) throw new TransportError("server", "invalid_snapshot");
    return page;
  },
  async visibleIds(ids) {
    const { data, error, status } = await (await userClient(userId)).rpc("sync_visible_transaction_ids", { p_ids: ids });
    if (error) throw classifyError({ status, message: error.message, networkFailure: status === 0 });
    if (!Array.isArray(data)) throw new TransportError("server", "invalid_snapshot");
    return data as string[];
  },
}; }
