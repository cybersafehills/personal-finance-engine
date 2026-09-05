import { Badge } from "../Badge";

// The canonical connected-source / connected-device status vocabulary
// (ADR 0007, assessment section 6.1). Every surface that shows connection
// health - the Connections page, a source card, the dashboard, the
// Financial Inbox, Settings - uses THESE seven words and this mapping, so
// "stale" never renders as "degraded" in one place and "Needs attention"
// in another.
//
// Status is never conveyed by color alone: the label text is always
// present (master prompt section 14 / WCAG).

export const CONNECTION_STATUSES = [
  "setup",
  "testing",
  "healthy",
  "stale",
  "paused",
  "error",
  "revoked",
] as const;

export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

type BadgeVariant = "accent" | "neutral" | "attention" | "positive";

const DISPLAY: Record<
  ConnectionStatus,
  { label: string; variant: BadgeVariant; hint: string }
> = {
  setup: {
    label: "Setup",
    variant: "neutral",
    hint: "Not finished connecting yet.",
  },
  testing: {
    label: "Testing",
    variant: "neutral",
    hint: "Checking the connection.",
  },
  healthy: {
    label: "Healthy",
    variant: "positive",
    hint: "Receiving activity normally.",
  },
  stale: {
    label: "No recent activity",
    variant: "attention",
    hint: "Nothing received lately - it may need reconnecting.",
  },
  paused: {
    label: "Paused",
    variant: "neutral",
    hint: "Temporarily not receiving activity.",
  },
  error: {
    label: "Needs attention",
    variant: "attention",
    hint: "Something is wrong with this connection.",
  },
  revoked: {
    label: "Disconnected",
    variant: "neutral",
    hint: "Access was removed.",
  },
};

export function connectionStatusLabel(status: ConnectionStatus): string {
  return DISPLAY[status].label;
}

export function connectionStatusHint(status: ConnectionStatus): string {
  return DISPLAY[status].hint;
}

export function ConnectionStatusBadge({ status }: { status: ConnectionStatus }) {
  const d = DISPLAY[status] ?? DISPLAY.error;
  return <Badge variant={d.variant}>{d.label}</Badge>;
}

/**
 * Same vocabulary, spoken about a financial source rather than the
 * mechanism that feeds it. Kept as its own export so call sites read
 * clearly and the two can diverge later if the product needs it.
 */
export const SourceStatusBadge = ConnectionStatusBadge;
