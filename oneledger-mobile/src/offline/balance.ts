// Local balance honesty. Three different things, never blended silently:
//
//   confirmedRwf   the provider's own figure: balance_after on the newest
//                  SYNCED transaction that carries one.
//   pendingEffect  the effect of changes recorded on this device that the
//                  server has not acknowledged yet (each counted exactly once).
//   estimatedRwf   confirmed + pending: a local ESTIMATE, labelled as such. It
//                  is not what the bank or mobile-money provider holds.
//
// Unsynced manual entries never carry balance_after, so they can only move the
// estimate, not the confirmed figure.

export type BalanceTx = {
  id: string;
  occurred_at: string;
  balance_after_rwf: number | null;
  principal_effect_rwf: number | null;
  fee_effect_rwf: number | null;
  settlement_state: string | null;
  sync_state: string;
  dedupe_state?: string;
  server_updated_at?: string | null;
};

export type LocalBalance = {
  confirmedRwf: number | null;
  confirmedAsOfIso: string | null;
  pendingEffectRwf: number;
  pendingCount: number;
  estimatedRwf: number | null;
  /** True when the estimate includes changes the server has not confirmed. */
  includesUnsynced: boolean;
};

const UNSYNCED = new Set(["local_only", "pending", "syncing", "conflict", "failed"]);

export function computeLocalBalance(rows: BalanceTx[]): LocalBalance {
  let confirmed: BalanceTx | null = null;
  let pendingEffect = 0;
  let pendingCount = 0;
  const seen = new Set<string>();

  for (const row of rows) {
    if (seen.has(row.id) || row.dedupe_state === "merged") continue; // a row is never counted twice
    seen.add(row.id);
    if (UNSYNCED.has(row.sync_state) && row.server_updated_at == null) {
      // Refused (failed) entries are shown but are NOT part of the estimate.
      if (row.sync_state !== "failed" && row.settlement_state === "settled") {
        pendingEffect += (row.principal_effect_rwf ?? 0) + (row.fee_effect_rwf ?? 0);
        pendingCount += 1;
      }
    } else if (row.balance_after_rwf !== null) {
      if (!confirmed || row.occurred_at > confirmed.occurred_at) confirmed = row;
    }
  }

  const confirmedRwf = confirmed?.balance_after_rwf ?? null;
  return {
    confirmedRwf,
    confirmedAsOfIso: confirmed?.occurred_at ?? null,
    pendingEffectRwf: pendingEffect,
    pendingCount,
    estimatedRwf: confirmedRwf === null ? null : confirmedRwf + pendingEffect,
    includesUnsynced: pendingCount > 0,
  };
}

export type Freshness = {
  label: string;
  /** Whether figures may be missing server-side changes or include local ones. */
  caveat: "none" | "includes_unsynced" | "may_be_stale" | "never_synced";
};

/** How to describe the dataset behind any locally computed figure. */
export function describeFreshness(input: {
  lastSyncedAtIso: string | null;
  unsyncedCount: number;
  nowMs: number;
  staleAfterMs?: number;
}): Freshness {
  const stale = input.staleAfterMs ?? 24 * 60 * 60_000;
  if (!input.lastSyncedAtIso) return { label: "Not yet synced on this device", caveat: "never_synced" };
  const age = input.nowMs - Date.parse(input.lastSyncedAtIso);
  if (input.unsyncedCount > 0) {
    return { label: `Includes ${input.unsyncedCount} change${input.unsyncedCount === 1 ? "" : "s"} not yet synced`, caveat: "includes_unsynced" };
  }
  if (age > stale) return { label: "Last synced a while ago; newer activity may be missing", caveat: "may_be_stale" };
  return { label: "Up to date", caveat: "none" };
}
