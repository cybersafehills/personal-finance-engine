// Pure event catalog + envelope builder for outbound webhooks
// (Integrations Phase 4, migration 20261123000000). No server-only import
// - unit-tested and reused by the subscription UI.

export const WEBHOOK_EVENTS = [
  "transaction.created",
  "import.committed",
  "export.completed",
  "accountant_package.completed",
  "ledger.synced",
  "reconciliation.flagged",
  "webhook.ping",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export function isKnownWebhookEvent(value: string): value is WebhookEvent {
  return (WEBHOOK_EVENTS as readonly string[]).includes(value);
}

/** Keep only recognised event types, deduped, in canonical order. */
export function normalizeEventTypes(raw: unknown): WebhookEvent[] {
  const input = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  for (const v of input) {
    if (typeof v === "string" && isKnownWebhookEvent(v)) seen.add(v);
  }
  return WEBHOOK_EVENTS.filter((e) => seen.has(e));
}

export type WebhookEnvelope = {
  id: string;
  type: WebhookEvent;
  created_at: string;
  workspace_id: string;
  data: Record<string, unknown>;
};

/**
 * Build the exact JSON envelope that gets signed and POSTed. `data` is a
 * caller-supplied, ALREADY-REDACTED object: ids and safe scalar fields
 * only - never raw financial text, counterparties, tokens or storage
 * paths. This function does not fetch or redact anything; it only frames.
 */
export function buildWebhookEnvelope(params: {
  deliveryId: string;
  type: WebhookEvent;
  workspaceId: string;
  data: Record<string, unknown>;
  now?: Date;
}): WebhookEnvelope {
  return {
    id: params.deliveryId,
    type: params.type,
    created_at: (params.now ?? new Date()).toISOString(),
    workspace_id: params.workspaceId,
    data: params.data ?? {},
  };
}
