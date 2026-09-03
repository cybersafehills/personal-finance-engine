import { Badge } from "../Badge";
import type {
  BillValidationFindingRow,
  BillValidationRow,
} from "../../lib/bills/queries";

// Read-only rendering of the deterministic validation run (Phase 3).
// Findings are ordered most-severe first by the query. Severity is
// always a text label, never colour alone (master prompt §22). Each
// finding names the specific problem and a suggested action - no vague
// "unusual data" messages.

const SEVERITY_LABEL: Record<
  string,
  { label: string; variant: "attention" | "accent" | "neutral" }
> = {
  blocking: { label: "Blocking", variant: "attention" },
  needs_specialist: { label: "Specialist review", variant: "accent" },
  possible_duplicate: { label: "Possible duplicate", variant: "accent" },
  warning: { label: "Warning", variant: "accent" },
  info: { label: "Info", variant: "neutral" },
};

export function BillValidationFindings({
  validation,
  findings,
}: {
  validation: BillValidationRow | null;
  findings: BillValidationFindingRow[];
}) {
  if (!validation) {
    return <p className="text-sm text-text-muted">No checks have run yet.</p>;
  }

  if (validation.status === "failed") {
    return (
      <p className="text-sm text-text-muted" role="status">
        The automated checks couldn&rsquo;t run for this document. A reviewer
        should verify the figures manually.
      </p>
    );
  }

  if (findings.length === 0) {
    return (
      <p className="text-sm text-money-positive" role="status">
        No issues found by the automated checks. A person still reviews every
        document before it affects the ledger.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {findings.map((f) => {
        const sev = SEVERITY_LABEL[f.severity] ?? SEVERITY_LABEL.info;
        return (
          <li
            key={f.id}
            className="flex flex-col gap-1 rounded-card border border-border-subtle bg-surface p-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={sev.variant}>{sev.label}</Badge>
              <span className="text-sm font-medium text-text-primary">{f.title}</span>
              {f.blocks_approval && (
                <span className="text-xs font-medium text-attention">blocks approval</span>
              )}
            </div>
            {f.detail && <p className="text-sm text-text-secondary">{f.detail}</p>}
            {f.suggested_action && (
              <p className="text-xs text-text-muted">Suggested: {f.suggested_action}</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
