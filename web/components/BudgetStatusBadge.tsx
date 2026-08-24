import { Badge } from "./Badge";

const STATUS_LABELS: Record<string, { label: string; variant: "accent" | "neutral" | "attention" | "positive" }> = {
  draft: { label: "Draft", variant: "neutral" },
  active: { label: "Active", variant: "positive" },
  completed: { label: "Completed", variant: "accent" },
  archived: { label: "Archived", variant: "attention" },
};

export function BudgetStatusBadge({ status }: { status: string }) {
  const { label, variant } = STATUS_LABELS[status] ?? { label: status, variant: "neutral" as const };
  return <Badge variant={variant}>{label}</Badge>;
}

/** Formats a plain SQL date ("2026-08-01") as "Aug 1, 2026" without any timezone shift - it is already a calendar date, not an instant. */
export function formatCalendarDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
