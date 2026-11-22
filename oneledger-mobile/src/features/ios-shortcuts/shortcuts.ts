// The iPhone path (ADR 0019 §9). iOS does not let an app observe other
// apps' notifications, so on iPhone OneLedger records MoMo messages through
// one combined Apple Shortcut plus a Messages trigger the user approves.
// "OneLedger Capture" pairs interactively and records incoming messages.
// "Connect to OneLedger" is retained for legacy two-shortcut installs.
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
export function connectShortcutRunUrl(token: string, name = CONNECT_SHORTCUT_NAME): string {
  return [
    `shortcuts://run-shortcut?name=${encodeURIComponent(name)}`,
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

/** Compact iOS 27 reference. The visible guide selects the device's layout. */
export const AUTOMATION_STEPS: string[] = [
  "Open the installed OneLedger Capture shortcut. Tap Edit → Automation → Message.",
  "Change the left Sender label to Message and set contains RWF. Remove unfinished or duplicate conditions.",
  "Expand the trigger: Automation on, Confirm Before Run off.",
  "Allow Running When Locked in Edit → Info → Privacy. Return with the back arrow to save.",
];
