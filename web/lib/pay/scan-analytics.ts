// Privacy-conscious product-event tracking for the "Scan to pay" surface
// (master prompt section 13). Like lib/directory/analytics.ts, this
// codebase has NO analytics provider wired in - this module is the one
// place a sink would attach, and it hard-strips anything that looks like
// personal or payment data BEFORE it could leave the process, so the
// redaction stays unit-testable whether or not a sink is connected.
//
// Phase R1 emits only the camera-shell lifecycle. Later phases add the
// decode / classification / handoff / reconciliation events - always as
// coarse category enums, NEVER a raw QR payload, USSD string, phone
// number, amount, or reference.

export type ScanEventName =
  | "scan_to_pay_opened"
  | "scan_camera_permission"
  | "scan_camera_started"
  | "scan_torch_toggled"
  | "scan_to_pay_closed";

/** Coarse outcome for `scan_camera_permission` - never a raw error
 *  string or stack. Mirrors ScanErrorKind in ScanToPay.tsx plus the
 *  success case. */
export type ScanPermissionOutcome =
  | "granted"
  | "denied"
  | "dismissed"
  | "no_camera"
  | "in_use"
  | "insecure_context"
  | "unsupported"
  | "error";

// Keys that must never reach analytics, and value shapes that look like
// raw identifiers. Same guard as the directory module - a QR payload, a
// filled USSD string, a phone/account number all trip one of these.
const FORBIDDEN_KEY =
  /phone|msisdn|account|meter|merchant|billing|amount|reference|pin|otp|ussd|payload|qr|raw|national_id|nid|email|name/i;
const LOOKS_LIKE_IDENTIFIER = /(\d[\s-]?){6,}|[*#]|https?:\/\//i;

export function sanitizeScanEventProps(
  props: Record<string, unknown> | undefined,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!props) return out;
  for (const [key, value] of Object.entries(props)) {
    if (FORBIDDEN_KEY.test(key)) continue;
    if (typeof value === "boolean" || typeof value === "number") {
      out[key] = value;
      continue;
    }
    if (typeof value === "string") {
      if (LOOKS_LIKE_IDENTIFIER.test(value)) continue;
      out[key] = value.slice(0, 64);
    }
  }
  return out;
}

export function trackScanEvent(
  name: ScanEventName,
  props?: Record<string, unknown>,
): void {
  const safe = sanitizeScanEventProps(props);
  // No provider connected. When one is added, forward `{ name, ...safe }`
  // here - never the raw `props`.
  if (process.env.NODE_ENV !== "production") {
    console.debug("[scan-event]", name, safe);
  }
}
