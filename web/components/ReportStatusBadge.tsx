import { Badge } from "./Badge";
import type { ReportRunStatus } from "../lib/queries";

const STATUS_DISPLAY: Record<
  ReportRunStatus,
  { label: string; variant: "accent" | "neutral" | "attention" | "positive" }
> = {
  scheduled: { label: "Scheduled", variant: "neutral" },
  generating: { label: "Generating", variant: "neutral" },
  generated: { label: "Generated", variant: "positive" },
  generation_failed: { label: "Generation failed", variant: "attention" },
  delivery_pending: { label: "Delivery pending", variant: "neutral" },
  delivering: { label: "Sending", variant: "neutral" },
  delivered: { label: "Delivered", variant: "positive" },
  delivery_failed: { label: "Delivery failed", variant: "attention" },
};

export function ReportStatusBadge({ status }: { status: ReportRunStatus }) {
  const { label, variant } = STATUS_DISPLAY[status];
  return <Badge variant={variant}>{label}</Badge>;
}
