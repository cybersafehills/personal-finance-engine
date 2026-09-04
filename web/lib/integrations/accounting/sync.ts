import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { resolvePeriod } from "../export/period.ts";
import { buildExportDataset } from "../export/query.ts";
import { nextAttemptState } from "../sync-engine.ts";
import { fireWebhookEvent } from "../webhooks/dispatch.ts";
import {
  type AccountingEntry,
  type AccountingProviderKey,
  isAccountingProviderKey,
  ledgerMapKeyForCategory,
  normalizeAccountMap,
  type OAuthTokenSet,
} from "./contract.ts";
import { getAccountingAdapter } from "./registry.ts";

export type LedgerSyncResult =
  | { ok: true; syncRunId: string; counts: Record<string, number> }
  | { ok: false; error: string; syncRunId?: string };

const EMPTY_TOKEN: OAuthTokenSet = {
  accessToken: "",
  refreshToken: null,
  expiresAt: null,
  scope: null,
};

/**
 * Run one connected-ledger sync. Export direction only: build the whole
 * ledger, map each row's category to an external account via account_map,
 * and hand the entries to the provider adapter. Every provider ships dark
 * (provider_not_configured) or with pushEntries unimplemented
 * (provider_push_not_implemented) - either way the run is recorded
 * `partial`, never a fake success. Real transient failures go through the
 * shared retry policy.
 */
export async function runLedgerSync(
  admin: SupabaseClient,
  input: {
    ledgerId: string;
    workspaceId: string;
    trigger: "manual" | "scheduled" | "poll";
    attempt?: number;
  },
): Promise<LedgerSyncResult> {
  const { data: ledger } = await admin
    .from("connected_ledgers")
    .select(
      "id, workspace_id, destination_id, external_ref, account_map, status",
    )
    .eq("id", input.ledgerId)
    .eq("workspace_id", input.workspaceId)
    .maybeSingle();
  if (!ledger) return { ok: false, error: "ledger not found" };
  if (ledger.status === "paused" || ledger.status === "disconnected") {
    return { ok: false, error: `ledger is ${ledger.status}` };
  }

  const { data: destination } = await admin
    .from("integration_destinations")
    .select("id, provider")
    .eq("id", ledger.destination_id)
    .maybeSingle();
  const providerRaw = destination?.provider ?? "";
  if (!isAccountingProviderKey(providerRaw)) {
    return { ok: false, error: "unknown accounting provider" };
  }
  const provider = providerRaw as AccountingProviderKey;

  const { data: run } = await admin
    .from("integration_sync_runs")
    .insert({
      workspace_id: input.workspaceId,
      destination_id: ledger.destination_id,
      connected_ledger_id: ledger.id,
      trigger: input.trigger,
      direction: "export",
      status: "running",
      attempt: input.attempt ?? 0,
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  const syncRunId = run?.id as string | undefined;

  const finish = async (
    status: "succeeded" | "partial" | "failed",
    counts: Record<string, number>,
    error: Record<string, unknown> | null,
  ) => {
    if (syncRunId) {
      await admin
        .from("integration_sync_runs")
        .update({
          status,
          counts,
          error,
          finished_at: new Date().toISOString(),
        })
        .eq("id", syncRunId);
    }
    await admin
      .from("connected_ledgers")
      .update({
        last_sync_run_id: syncRunId ?? null,
        status: status === "failed"
          ? "error"
          : status === "partial"
          ? "needs_auth"
          : "active",
      })
      .eq("id", ledger.id);
    await admin.from("integration_events").insert({
      workspace_id: input.workspaceId,
      kind: status === "succeeded" ? "ledger.synced" : "ledger.sync_failed",
      severity: status === "succeeded" ? "info" : "warning",
      ref_type: "connected_ledger",
      ref_id: ledger.id,
      summary: status === "succeeded"
        ? `Ledger synced — ${counts.pushed ?? 0} entries`
        : `Ledger sync ${status}`,
      context: { provider, trigger: input.trigger },
    });
    if (status === "succeeded") {
      fireWebhookEvent(admin, {
        workspaceId: input.workspaceId,
        type: "ledger.synced",
        eventRef: ledger.id,
        data: {
          ledger_id: ledger.id,
          provider,
          pushed: counts.pushed ?? 0,
          skipped: counts.skipped ?? 0,
        },
      });
    }
  };

  const accountMap = normalizeAccountMap(ledger.account_map);
  const counts: Record<string, number> = {};

  try {
    const period = resolvePeriod({ kind: "relative", preset: "all" }, new Date());
    const dataset = await buildExportDataset(
      admin,
      input.workspaceId,
      { from: period.from, to: period.to, accountIds: null, directions: null },
      period.label,
    );

    const entries: AccountingEntry[] = [];
    let unmapped = 0;
    for (const t of dataset.transactions) {
      const key = ledgerMapKeyForCategory(t.category);
      if (!accountMap[key]) {
        unmapped += 1;
        continue;
      }
      entries.push({
        date: t.occurredAt,
        description: t.description ?? "",
        amountMinor: t.direction === "out" ? -t.amountMinor : t.amountMinor,
        currency: t.currency,
        oneledgerKey: key,
        externalTxnId: t.id,
      });
    }
    counts.eligible = entries.length;
    counts.unmapped = unmapped;

    // Load the stored OAuth token, if any. A missing token on a
    // configured provider still reaches pushEntries, which is
    // unimplemented and yields a `partial` run below.
    const { data: secret } = await admin
      .from("integration_destination_secrets")
      .select("secret_material")
      .eq("destination_id", ledger.destination_id)
      .eq("secret_kind", "oauth_token")
      .maybeSingle();
    let token = EMPTY_TOKEN;
    if (secret?.secret_material) {
      try {
        token = JSON.parse(secret.secret_material as string) as OAuthTokenSet;
      } catch {
        // fall through with the empty token
      }
    }

    const adapter = getAccountingAdapter(provider);
    const pushResult = await adapter.pushEntries(token, {
      externalRef: ledger.external_ref ?? null,
      accountMap,
      entries,
    });
    counts.pushed = pushResult.pushed;
    counts.skipped = pushResult.skipped;

    await finish("succeeded", counts, null);
    return { ok: true, syncRunId: syncRunId ?? "", counts };
  } catch (err) {
    const errCode = (err as { code?: string })?.code;
    const code = errCode === "provider_not_configured"
      ? "provider_not_configured"
      : (err instanceof Error && err.message === "provider_push_not_implemented")
      ? "provider_push_not_implemented"
      : "ledger_sync_failed";
    const message = err instanceof Error ? err.message.slice(0, 200) : "failed";

    // Dark-provider states: a `partial` run, no retry.
    if (
      code === "provider_not_configured" ||
      code === "provider_push_not_implemented"
    ) {
      await finish("partial", counts, { code, message });
      return { ok: false, error: code, syncRunId };
    }

    // Real failure: let the retry policy decide.
    const state = nextAttemptState(input.attempt ?? 0, code, Date.now());
    if (syncRunId) {
      await admin
        .from("integration_sync_runs")
        .update({
          status: state.status,
          counts,
          error: { code, message },
          attempt: state.attempt,
          next_attempt_at: state.nextAttemptAtMs
            ? new Date(state.nextAttemptAtMs).toISOString()
            : null,
          finished_at: state.status === "failed"
            ? new Date().toISOString()
            : null,
        })
        .eq("id", syncRunId);
    }
    const ledgerStatus = state.markNeedsAuth
      ? "needs_auth"
      : state.status === "failed"
      ? "error"
      : "active";
    await admin
      .from("connected_ledgers")
      .update({ last_sync_run_id: syncRunId ?? null, status: ledgerStatus })
      .eq("id", ledger.id);
    if (state.markNeedsAuth) {
      await admin
        .from("integration_destinations")
        .update({ status: "needs_auth", last_error_code: code })
        .eq("id", ledger.destination_id);
      await notifyLedgerOwner(admin, {
        workspaceId: input.workspaceId,
        ledgerId: ledger.id,
        title: "A connected ledger needs re-authorising",
        body: "A sync failed because the accounting connection is no longer valid.",
      });
    }
    await admin.from("integration_events").insert({
      workspace_id: input.workspaceId,
      kind: "ledger.sync_failed",
      severity: "warning",
      ref_type: "connected_ledger",
      ref_id: ledger.id,
      summary: state.status === "queued"
        ? `Ledger sync failed — retrying (attempt ${state.attempt})`
        : "Ledger sync failed",
      context: { provider, code, trigger: input.trigger },
    });
    return { ok: false, error: code, syncRunId };
  }
}

async function notifyLedgerOwner(
  admin: SupabaseClient,
  p: { workspaceId: string; ledgerId: string; title: string; body: string },
): Promise<void> {
  const { data: ledger } = await admin
    .from("connected_ledgers")
    .select("created_by")
    .eq("id", p.ledgerId)
    .maybeSingle();
  if (!ledger?.created_by) return;
  await admin.from("notifications").insert({
    workspace_id: p.workspaceId,
    user_id: ledger.created_by,
    event_key: "integration.ledger_needs_auth",
    channel: "in_app",
    title: p.title,
    body: p.body,
    resource_type: "connected_ledger",
    resource_id: p.ledgerId,
  });
}
