// The iPhone path (ADR 0019 §9). iOS does not let an app observe other
// apps' notifications, so on iPhone OneLedger records MoMo messages through
// two Apple Shortcuts plus a Messages automation the user approves:
//   - "Connect to OneLedger"  runs once, redeems the pairing code
//   - "OneLedger Capture"     run by the automation, forwards each message
// Spec: docs/oneledger-capture-shortcut.md. Names must match exactly; the
// run URL and the automation refer to them by name.

export const CONNECT_SHORTCUT_NAME = "Connect to OneLedger";
export const CAPTURE_SHORTCUT_NAME = "OneLedger Capture";

/**
 * Runs the pairing Shortcut with the one-time code as its input. Same URL
 * as web/lib/pairing.ts `devicePairShortcutRunUrl`. encodeURIComponent
 * encodes spaces as %20, never "+": the Shortcuts URL scheme treats "+"
 * literally and reports "the file doesn't exist".
 */
export function connectShortcutRunUrl(token: string): string {
  return [
    `shortcuts://run-shortcut?name=${encodeURIComponent(CONNECT_SHORTCUT_NAME)}`,
    "input=text",
    `text=${encodeURIComponent(token)}`,
  ].join("&");
}

/** Opens the Shortcuts app (for building the Messages automation). */
export const SHORTCUTS_APP_URL = "shortcuts://";

export type IosGuideStep = "install" | "connect" | "automate" | "verify";

export const IOS_GUIDE_STEPS: { key: IosGuideStep; title: string }[] = [
  { key: "install", title: "Add the Shortcuts" },
  { key: "connect", title: "Connect this iPhone" },
  { key: "automate", title: "Turn on forwarding" },
  { key: "verify", title: "Check it works" },
];

export function iosGuideStepNumber(step: IosGuideStep): number {
  return IOS_GUIDE_STEPS.findIndex((s) => s.key === step) + 1;
}

export type PairingStatus = "pending" | "consumed" | "expired" | "cancelled";

/**
 * What the connect step should show for a pairing session. A session past
 * its expiry is treated as expired even if the server's sweep has not
 * marked it yet (the server re-checks on redemption regardless).
 */
export function connectPhase(
  status: PairingStatus | null,
  expiresAtIso: string | null,
  nowMs: number,
): "waiting" | "connected" | "expired" {
  if (status === "consumed") return "connected";
  if (status === "expired" || status === "cancelled") return "expired";
  if (expiresAtIso && new Date(expiresAtIso).getTime() <= nowMs) return "expired";
  return "waiting";
}

/** "9 min left" / "less than a minute left" for the code's countdown. */
export function expiryLabel(expiresAtIso: string, nowMs: number): string {
  const ms = new Date(expiresAtIso).getTime() - nowMs;
  if (ms <= 0) return "Expired";
  const minutes = Math.floor(ms / 60_000);
  return minutes < 1 ? "Less than a minute left" : `${minutes} min left`;
}

/** The numbered instructions for the Messages automation, in order. */
export const AUTOMATION_STEPS: string[] = [
  "Open the Shortcuts app and tap Automation at the bottom.",
  "Tap + (top right), then choose Message.",
  "Leave Sender empty. In Message Contains, type RWF.",
  "Choose Run Immediately, and turn Notify When Run off.",
  "Tap Next, then choose the shortcut called OneLedger Capture.",
  "Tap Done.",
];
