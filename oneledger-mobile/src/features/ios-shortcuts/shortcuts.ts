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

/**
 * Build the two Shortcuts by hand, for as long as no iCloud links are published
 * (config.connectShortcutUrl is empty). The actions and field names are the ones
 * in docs/oneledger-capture-shortcut.md (verified against the capture endpoint);
 * the shortcut NAMES must match CONNECT_SHORTCUT_NAME / CAPTURE_SHORTCUT_NAME.
 */
export const CAPTURE_ENDPOINT = "https://api.oneledger.me/v1/capture";

export const MANUAL_BUILD: { name: string; purpose: string; steps: string[] }[] = [
  {
    name: CONNECT_SHORTCUT_NAME,
    purpose: "Runs once. Swaps the code shown in OneLedger for this phone's own secure key.",
    steps: [
      "Add Ask for Input (type Text). Prompt: Enter the pairing code from OneLedger.",
      "Make the device key: add Text pfe_ and Set Variable Secret. Then Repeat 6 times: Random Number 100000000 to 999999999, then Text with Secret followed by the Random Number, then Set Variable Secret. Finally Set Variable DeviceSecret to Secret.",
      "Add Dictionary: op = pair, pairing_token = Provided Input, device_secret = DeviceSecret, client_version = 1.0.0, platform = ios, device_label = Device Name.",
      `Add Get Contents of URL: ${CAPTURE_ENDPOINT}. Method POST, Request Body JSON, using that Dictionary.`,
      "Add Get Dictionary Value ok from the result. If it is not true: Show Result of the error value, then Stop Shortcut.",
      "Add Get Dictionary Value capture_url from the result.",
      "Add Dictionary: secret = DeviceSecret, url = capture_url.",
      "Add Save File to the Shortcuts folder as OneLedger/config.json, Overwrite If File Exists on.",
      "Add Show Notification: This iPhone is connected to OneLedger.",
    ],
  },
  {
    name: CAPTURE_SHORTCUT_NAME,
    purpose: "Run by the Messages automation. Sends each money message to OneLedger.",
    steps: [
      "Add Get File OneLedger/config.json, then Get Dictionary from Input.",
      "Add Get Dictionary Value secret, and again for url.",
      "Add Dictionary: op = capture, message = Shortcut Input, received_at = Current Date formatted as ISO 8601, client_version = 1.0.0.",
      "Add Get Contents of URL: the url value. Method POST, header x-device-key = the secret value, Request Body JSON, using that Dictionary.",
    ],
  },
];
