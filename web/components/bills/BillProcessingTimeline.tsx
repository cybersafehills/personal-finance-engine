import { formatFullDateTime } from "../../lib/format";
import type { BillProcessingEventRow } from "../../lib/bills/queries";
import { billActorLabel, billEventLabel } from "../../lib/bills/display";

// Human-readable rendering of the append-only processing journal (master
// prompt §16/§21). Presentational only - the caller decides whether to
// show it at all (it requires the bill.audit.view capability, enforced by
// RLS: a member without it gets an empty list, and the parent shows the
// "no permission" note instead).

const labelFor = billEventLabel;
const actorLabel = billActorLabel;

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
