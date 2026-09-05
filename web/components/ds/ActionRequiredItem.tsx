import Link from "next/link";

// The Financial Inbox row primitive (assessment section 6.1 / master
// prompt "ActionRequiredItem"). One consistent shape for anything that
// needs a human decision - a duplicate to review, a source that went
// stale, a bill to approve, a transaction to attribute - regardless of
// which domain owns the underlying workflow.
//
// Presentational only. The Inbox stays a read/projection layer: the
// primary link drills into the owning surface, and any inline `action`
// passed in must call that domain's authoritative RPC itself. Severity is
// shown with a text label + a shape, never color alone.

export type ActionRequiredSeverity = "critical" | "high" | "normal";

const SEVERITY: Record<
  ActionRequiredSeverity,
  { label: string; dot: string; text: string }
> = {
  critical: {
    label: "Critical",
    dot: "bg-attention",
    text: "text-attention",
  },
  high: { label: "Needs attention", dot: "bg-accent", text: "text-accent" },
  normal: { label: "Review", dot: "bg-border-strong", text: "text-text-muted" },
};

export function ActionRequiredItem({
  severity,
  title,
  description,
  href,
  sourceLabel,
  timestamp,
  affectedCount,
  action,
  onDismiss,
}: {
  severity: ActionRequiredSeverity;
  title: string;
  description?: string;
  /** Drill-in to the owning workflow surface. */
  href: string;
  sourceLabel?: string;
  /** Preformatted, e.g. "2 days ago". */
  timestamp?: string;
  affectedCount?: number;
  /** Optional lightweight inline control - must invoke the domain RPC. */
  action?: React.ReactNode;
  onDismiss?: () => void;
}) {
  const sev = SEVERITY[severity];
  return (
    <li className="flex items-start gap-3 rounded-card border border-border-subtle bg-surface p-4">
      <span
        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${sev.dot}`}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <Link
            href={href}
            className="text-sm font-medium text-text-primary hover:underline"
          >
            {title}
          </Link>
          <span className={`text-xs font-medium ${sev.text}`}>{sev.label}</span>
          {affectedCount != null && affectedCount > 1 && (
            <span className="text-xs text-text-muted">
              {affectedCount} items
            </span>
          )}
        </div>
        {description && (
          <p className="mt-0.5 text-sm text-text-muted">{description}</p>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-text-muted">
          {sourceLabel && <span>{sourceLabel}</span>}
          {sourceLabel && timestamp && <span aria-hidden="true">·</span>}
          {timestamp && <span>{timestamp}</span>}
        </div>
        {(action || onDismiss) && (
          <div className="mt-2 flex items-center gap-2">
            {action}
            {onDismiss && (
              <button
                type="button"
                onClick={onDismiss}
                className="min-h-9 rounded-control px-2 text-xs font-medium text-text-muted hover:text-text-primary"
              >
                Dismiss
              </button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
