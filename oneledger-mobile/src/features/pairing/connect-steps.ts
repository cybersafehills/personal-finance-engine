import type { CaptureHealth } from "@/features/capture/capture";

// The connect flow has no stored "current step". The step is derived from
// the engine's real state every time, so the flow is resumable: leaving to
// system settings and coming back, or reopening the app days later, lands
// on whatever is genuinely still missing.

export type ConnectStep = "disclosure" | "connect" | "allow_access" | "keep_running" | "done";

export const CONNECT_STEPS: { key: ConnectStep; title: string }[] = [
  { key: "disclosure", title: "How it works" },
  { key: "connect", title: "Connect" },
  { key: "allow_access", title: "Allow access" },
  { key: "keep_running", title: "Keep it running" },
];

export function currentConnectStep(
  health: Pick<CaptureHealth, "paired" | "notificationAccessGranted" | "state">,
  flags: { disclosureAccepted: boolean; keepRunningSeen: boolean },
): ConnectStep {
  // A revoked credential must be re-paired even though one is stored.
  const needsPairing = !health.paired || health.state === "reauthentication_required";
  if (needsPairing) return flags.disclosureAccepted ? "connect" : "disclosure";
  if (!health.notificationAccessGranted) return "allow_access";
  if (!flags.keepRunningSeen) return "keep_running";
  return "done";
}

/** 1-based position for "Step N of M"; `done` reports the last step. */
export function connectStepNumber(step: ConnectStep): number {
  const index = CONNECT_STEPS.findIndex((s) => s.key === step);
  return index === -1 ? CONNECT_STEPS.length : index + 1;
}
