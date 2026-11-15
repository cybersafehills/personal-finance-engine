// How an iPhone's Shortcut connection is doing, from what the server knows:
// when the device credential was created and when it last sent something.
// iOS gives the app no direct view of the Shortcut, so this is the only
// honest signal (the Android engine has real on-device health; see
// features/capture/health-display.ts).

export type IosHealthState =
  /** Heard from it recently. */
  | "working"
  /** Connected, nothing received yet, and it is still early. */
  | "waiting"
  /** Silent for a while (or never heard) - worth checking the automation. */
  | "quiet"
  /** The server revoked or paused the credential. */
  | "disconnected";

export type IosDeviceStatus = {
  status: "active" | "paused" | "revoked";
  createdAtIso: string;
  lastUsedAtIso: string | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;
/** Quiet this long is worth a look; shorter is normal for a light MoMo user. */
export const QUIET_AFTER_DAYS = 7;
/** A brand-new connection gets this long before "nothing yet" becomes "quiet". */
export const WAITING_GRACE_DAYS = 3;

export function iosHealthState(device: IosDeviceStatus, nowMs: number): IosHealthState {
  if (device.status !== "active") return "disconnected";
  if (device.lastUsedAtIso) {
    return nowMs - new Date(device.lastUsedAtIso).getTime() <= QUIET_AFTER_DAYS * DAY_MS
      ? "working"
      : "quiet";
  }
  return nowMs - new Date(device.createdAtIso).getTime() <= WAITING_GRACE_DAYS * DAY_MS
    ? "waiting"
    : "quiet";
}

/** "just now" / "5 minutes ago" / "3 hours ago" / "2 days ago". */
export function lastHeardLabel(lastUsedAtIso: string, nowMs: number): string {
  const ms = Math.max(0, nowMs - new Date(lastUsedAtIso).getTime());
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export type IosHealthDisplay = {
  variant: "positive" | "neutral" | "attention";
  label: string;
  detail: string;
};

export function iosHealthDisplay(
  device: IosDeviceStatus,
  nowMs: number,
): IosHealthDisplay {
  switch (iosHealthState(device, nowMs)) {
    case "working":
      return {
        variant: "positive",
        label: "Working",
        detail: `Last heard from this iPhone ${lastHeardLabel(device.lastUsedAtIso!, nowMs)}.`,
      };
    case "waiting":
      return {
        variant: "neutral",
        label: "Waiting for the first message",
        detail: "Your next MoMo message will confirm it.",
      };
    case "disconnected":
      return {
        variant: "attention",
        label: "Disconnected",
        detail: "This iPhone was disconnected from OneLedger. Connect it again to resume.",
      };
    case "quiet":
      return {
        variant: "attention",
        label: "Nothing received lately",
        detail: device.lastUsedAtIso
          ? `Last heard ${lastHeardLabel(device.lastUsedAtIso, nowMs)}. That is normal if you haven't used MoMo; otherwise check the forwarding steps.`
          : "Nothing has arrived from this iPhone yet. Check the forwarding steps.",
      };
  }
}

export type Troubleshooting = { problem: string; fix: string };

// The failures people actually hit with Shortcuts + Messages automations.
// Wording mirrors the setup steps in shortcuts.ts so the names match.
export const IOS_TROUBLESHOOTING: Troubleshooting[] = [
  {
    problem: "The Shortcut says it can't be found or the file doesn't exist",
    fix: "The Shortcuts must be named exactly “Connect to OneLedger” and “OneLedger Capture”. Rename them in the Shortcuts app if you changed them.",
  },
  {
    problem: "The automation asks me to confirm every time",
    fix: "Open the automation in Shortcuts and choose Run Immediately instead of Ask Before Running.",
  },
  {
    problem: "A MoMo message came in but nothing was recorded",
    fix: "Check the automation's Message Contains is exactly RWF with Sender left empty, and that the automation is switched on. Then run “OneLedger Capture” once by hand from the Shortcuts app and allow any permission it asks for.",
  },
  {
    problem: "It says disconnected or the code expired",
    fix: "Go back to Connect this iPhone and get a new code. Codes work once and expire after a few minutes.",
  },
  {
    problem: "I reinstalled the Shortcuts or got a new iPhone",
    fix: "Each iPhone connects once. Go back to Connect this iPhone and get a new code; the old connection stays disconnected.",
  },
];
