import type { BadgeVariant } from "@/components/ds";

import type { CaptureHealthState } from "./capture";

// How each native health state is shown. Labels follow the app's customer
// vocabulary ("connected phone", never "listener" or "credential").

export type HealthDisplay = {
  label: string;
  variant: BadgeVariant;
  /** What the user should do next, if anything. */
  action: "connect" | "allow_access" | "reconnect" | "none";
};

const DISPLAY: Record<CaptureHealthState, HealthDisplay> = {
  setup_required: { label: "Not connected", variant: "neutral", action: "connect" },
  permission_required: {
    label: "Needs permission",
    variant: "attention",
    action: "allow_access",
  },
  active: { label: "Working", variant: "positive", action: "none" },
  degraded: { label: "Catching up", variant: "attention", action: "none" },
  reauthentication_required: {
    label: "Disconnected",
    variant: "attention",
    action: "reconnect",
  },
  send_failed_permanent: {
    label: "Needs attention",
    variant: "attention",
    action: "none",
  },
};

export function healthDisplay(state: CaptureHealthState): HealthDisplay {
  return DISPLAY[state];
}

/** "Just now", "5 minutes ago", "3 hours ago", "2 days ago", or "Never". */
export function formatLastSuccess(lastSuccessAtMs: number, nowMs: number): string {
  if (lastSuccessAtMs <= 0) return "Never";
  const minutes = Math.floor(Math.max(0, nowMs - lastSuccessAtMs) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
