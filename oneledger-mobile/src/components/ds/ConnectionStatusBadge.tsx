import { Badge, type BadgeVariant } from "./Badge";

// The canonical 7-state connection vocabulary. Labels and hints are copied
// from web/components/ds/StatusBadge.tsx and must stay identical, so
// "stale" never reads differently on the phone than on the web.

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

const DISPLAY: Record<
  ConnectionStatus,
  { label: string; variant: BadgeVariant; hint: string }
> = {
  setup: { label: "Setup", variant: "neutral", hint: "Not finished connecting yet." },
  testing: { label: "Testing", variant: "neutral", hint: "Checking the connection." },
  healthy: { label: "Healthy", variant: "positive", hint: "Receiving activity normally." },
  stale: {
    label: "No recent activity",
    variant: "attention",
    hint: "Nothing received lately - it may need reconnecting.",
  },
  paused: { label: "Paused", variant: "neutral", hint: "Temporarily not receiving activity." },
  error: {
    label: "Needs attention",
    variant: "attention",
    hint: "Something is wrong with this connection.",
  },
  revoked: { label: "Disconnected", variant: "neutral", hint: "Access was removed." },
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
