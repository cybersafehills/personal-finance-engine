import { formatFullDateTime } from "../../lib/format";
import type { BillProcessingEventRow } from "../../lib/bills/queries";

// Human-readable rendering of the append-only processing journal (master
// prompt §16/§21). Presentational only - the caller decides whether to
// show it at all (it requires the bill.audit.view capability, enforced by
// RLS: a member without it gets an empty list, and the parent shows the
// "no permission" note instead).

const EVENT_LABEL: Record<string, string> = {
  document_received: "Document received and original stored",
  original_stored: "Original stored",
  status_changed: "Status changed",
  original_downloaded: "Original downloaded",
  document_archived: "Document archived",
  processing_retried: "Processing retried",
  processing_failed: "Processing failed",
};

function labelFor(event: BillProcessingEventRow): string {
  if (event.event_type === "status_changed" && event.previous_state && event.new_state) {
    return `Status: ${event.previous_state} → ${event.new_state}`;
  }
  return EVENT_LABEL[event.event_type] ?? event.event_type.replace(/_/g, " ");
}

function actorLabel(actorType: BillProcessingEventRow["actor_type"]): string {
  switch (actorType) {
    case "user":
      return "A person";
    case "system":
      return "The system";
    case "provider":
      return "The extraction provider";
    case "cron":
      return "A scheduled job";
  }
}

export function BillProcessingTimeline({
  events,
}: {
  events: BillProcessingEventRow[];
}) {
  if (events.length === 0) {
    return (
      <p className="text-sm text-text-muted">
        No processing history is visible to you.
      </p>
    );
  }

  return (
    <ol className="flex flex-col gap-3">
      {events.map((event) => (
        <li key={event.id} className="flex flex-col gap-0.5 border-l-2 border-border-subtle pl-3">
          <span className="text-sm font-medium text-text-primary">{labelFor(event)}</span>
          <span className="text-xs text-text-muted">
            {actorLabel(event.actor_type)} · {formatFullDateTime(event.created_at)}
            {event.outcome && event.outcome !== "ok" ? ` · ${event.outcome}` : ""}
          </span>
        </li>
      ))}
    </ol>
  );
}
