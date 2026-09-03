// Pure shaping of raw integration_events rows into the feed rendered at
// /integrations/activity. No server-only import - unit-tested directly.

import type { IntegrationEvent, IntegrationEventSeverity } from "./model.ts";

export type IntegrationActivityItem = {
  id: string;
  kind: string;
  severity: IntegrationEventSeverity;
  summary: string;
  at: string;
  /** Deep link to the owning workflow, when the ref resolves to one. */
  href: string | null;
};

export type IntegrationActivityView = {
  items: IntegrationActivityItem[];
  total: number;
  warningCount: number;
  errorCount: number;
};

/** Best-effort deep link from an event's ref back to its workflow surface. */
export function activityHref(
  refType: string | null,
  refId: string | null,
): string | null {
  if (!refType) return null;
  switch (refType) {
    case "import_batch":
      return refId ? `/integrations/imports/${refId}` : "/integrations/imports";
    case "export_job":
      return "/integrations/exports";
    case "connector_installation":
    case "ingestion_connection":
      return "/integrations/connections";
    default:
      return null;
  }
}

export function buildIntegrationActivity(
  events: IntegrationEvent[],
): IntegrationActivityView {
  const items = events.map((event) => ({
    id: event.id,
    kind: event.kind,
    severity: event.severity,
    summary: event.summary,
    at: event.createdAt,
    href: activityHref(event.refType, event.refId),
  }));

  return {
    items,
    total: items.length,
    warningCount: items.filter((i) => i.severity === "warning").length,
    errorCount: items.filter((i) => i.severity === "error").length,
  };
}
