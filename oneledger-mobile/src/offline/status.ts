import type { OutboxSummary } from "./outbox";

// What the sync indicator says. Pure so every state is tested.

export type SyncStatusKind = "unavailable" | "offline" | "syncing" | "attention" | "pending" | "synced";

export type SyncStatus = { kind: SyncStatusKind; label: string; detail: string };

export function deriveSyncStatus(input: {
  available: boolean;
  online: boolean;
  syncing: boolean;
  summary: OutboxSummary;
  authNeeded: boolean;
  refreshFailed?: boolean;
}): SyncStatus {
  const { summary } = input;
  const waiting = summary.pending + summary.inFlight + summary.retrying;
  if (!input.available) return { kind: "unavailable", label: "Online only", detail: "Offline saving isn't available on this build." };
  if (summary.conflicts > 0 && !input.authNeeded) {
    return {
      kind: "attention",
      label: "Needs your decision",
      detail: `${summary.conflicts} change${summary.conflicts === 1 ? "" : "s"} clash with an update made elsewhere. Nothing was overwritten.`,
    };
  }
  if (summary.needsAttention > 0 || input.authNeeded) {
    return {
      kind: "attention",
      label: input.authNeeded ? "Sign in to sync" : "Needs attention",
      detail: input.authNeeded
        ? "Your changes are saved on this device. Sign in again to send them."
        : `${summary.needsAttention} change${summary.needsAttention === 1 ? "" : "s"} couldn't be sent. Your data is safe on this device.`,
    };
  }
  if (input.refreshFailed && !input.syncing) return { kind: "attention", label: "Refresh failed", detail: "Saved activity may be out of date. Try syncing again; pending changes have been kept." };
  if (!input.online) {
    return {
      kind: "offline",
      label: waiting > 0 ? `Offline · ${waiting} saved` : "Offline",
      detail: waiting > 0 ? "Saved on this device. They'll sync when you're back online." : "You can keep using OneLedger. Changes sync later.",
    };
  }
  if (input.syncing) return { kind: "syncing", label: "Syncing…", detail: "Sending changes and checking for new activity." };
  if (waiting > 0) return { kind: "pending", label: `${waiting} to sync`, detail: "Saved on this device, waiting to be sent." };
  return { kind: "synced", label: "Up to date", detail: "Everything on this device is synced." };
}

/** Plain-language reason for a held operation. Never includes payload contents. */
export function explainError(code: string | null): string {
  switch (code) {
    case "invalid_time":
      return "The time on this entry was rejected (check your phone's clock, or edit the date).";
    case "not_found_or_forbidden":
      return "You no longer have permission to add to this account.";
    case "entity_exists":
    case "op_id_conflict":
      return "This entry clashes with an existing record.";
    case "invalid_amount":
    case "invalid_fee":
    case "invalid_text":
    case "invalid_transaction_type":
    case "invalid_direction":
    case "invalid_payload":
      return "The server didn't accept the details of this entry.";
    case "server_error":
    case "unexpected_response":
      return "The server had trouble. We stopped retrying; try again.";
    default:
      return code && code.startsWith("server_") ? "The server had trouble. We stopped retrying; try again." : "This couldn't be sent.";
  }
}
