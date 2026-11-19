import type { PayConfig } from "./types";

// What holding the centre Pay button does. A tap always opens the Pay sheet; a
// hold (after a delay the user picks) jumps straight to one action. The default
// is Scan to pay. Pure: the screen, the button and the tests all use this.

export type HoldActionId = "scan" | "request" | "person" | "merchant" | "ussd" | "sheet";

export type HoldTarget =
  | { pathname: "/scan" | "/request-new" | "/ussd" }
  | { pathname: "/pay-new"; params: { type: "pay_person" | "pay_merchant" } };

type HoldActionDef = {
  id: HoldActionId;
  label: string;
  description: string;
  /** Where it goes; null means "just open the Pay sheet, as a tap does". */
  target: HoldTarget | null;
  /** The server flag that must be on for this account. */
  needs: keyof PayConfig | null;
};

export const HOLD_ACTIONS: readonly HoldActionDef[] = [
  { id: "scan", label: "Scan to pay", description: "Open the camera to scan a merchant QR code.", target: { pathname: "/scan" }, needs: "scanToPay" },
  { id: "request", label: "Request payment", description: "Ask someone to pay you with a link.", target: { pathname: "/request-new" }, needs: "paymentRequests" },
  { id: "person", label: "Pay a person", description: "Start a payment to a phone number.", target: { pathname: "/pay-new", params: { type: "pay_person" } }, needs: "assistedPay" },
  { id: "merchant", label: "Pay a merchant", description: "Start a payment to a merchant code.", target: { pathname: "/pay-new", params: { type: "pay_merchant" } }, needs: "assistedPay" },
  { id: "ussd", label: "USSD directory", description: "Browse and dial USSD codes.", target: { pathname: "/ussd" }, needs: "ussdDirectory" },
  { id: "sheet", label: "Nothing extra", description: "Holding does the same as a tap: it opens the Pay menu.", target: null, needs: null },
];

/** How long the button must be held, in milliseconds. */
export const HOLD_DURATIONS: readonly { ms: number; label: string }[] = [
  { ms: 300, label: "0.3 seconds" },
  { ms: 500, label: "0.5 seconds" },
  { ms: 800, label: "0.8 seconds" },
  { ms: 1000, label: "1 second" },
  { ms: 1500, label: "1.5 seconds" },
];

export type HoldPrefs = { action: HoldActionId; durationMs: number };

export const DEFAULT_HOLD_PREFS: HoldPrefs = { action: "scan", durationMs: 500 };

/** Whatever was stored (possibly old, hand-edited or corrupt) becomes a valid setting. */
export function normalizeHoldPrefs(raw: unknown): HoldPrefs {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const action = HOLD_ACTIONS.some((a) => a.id === r.action) ? (r.action as HoldActionId) : DEFAULT_HOLD_PREFS.action;
  const durationMs = HOLD_DURATIONS.some((d) => d.ms === r.durationMs) ? (r.durationMs as number) : DEFAULT_HOLD_PREFS.durationMs;
  return { action, durationMs };
}

export function holdActionAvailable(id: HoldActionId, config: Partial<PayConfig> | null): boolean {
  const def = HOLD_ACTIONS.find((a) => a.id === id);
  if (!def) return false;
  return def.needs === null || config?.[def.needs] === true;
}

/**
 * Where a hold goes, or null to open the Pay sheet like a tap. A chosen action
 * that is not on for this account falls back to the sheet: never a hold that
 * leads to a screen the account cannot use.
 */
export function resolveHoldTarget(prefs: HoldPrefs, config: Partial<PayConfig> | null): HoldTarget | null {
  const def = HOLD_ACTIONS.find((a) => a.id === prefs.action);
  if (!def || !def.target) return null;
  return holdActionAvailable(def.id, config) ? def.target : null;
}

export function holdHint(prefs: HoldPrefs, config: Partial<PayConfig> | null): string {
  const def = HOLD_ACTIONS.find((a) => a.id === prefs.action);
  return def && resolveHoldTarget(prefs, config) ? `Tap for Pay and Services. Hold to ${def.label.toLowerCase()}.` : "Opens Pay and Services";
}
