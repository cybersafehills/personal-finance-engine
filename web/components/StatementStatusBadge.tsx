import { Badge } from "./Badge";
import type { StatementStatus } from "../lib/queries";

const DISPLAY: Record<
  StatementStatus,
  { label: string; variant: "neutral" | "positive" | "attention" }
> = {
  preparing: { label: "Preparing", variant: "neutral" },
  generating: { label: "Generating", variant: "neutral" },
  ready: { label: "Ready", variant: "positive" },
  failed: { label: "Failed", variant: "attention" },
};

export function StatementStatusBadge({ status }: { status: StatementStatus }) {
  const { label, variant } = DISPLAY[status] ?? DISPLAY.ready;
  return <Badge variant={variant}>{label}</Badge>;
}
