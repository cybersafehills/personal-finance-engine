/**
 * Capture health, derived natively (ADR 0010 §5). Never a stored flag.
 */
export type CaptureHealthState =
  | "setup_required"
  | "permission_required"
  | "active"
  | "degraded"
  | "reauthentication_required"
  | "send_failed_permanent";

export type CaptureHealth = {
  state: CaptureHealthState;
  /** Plain-language explanation of `state`, written natively. */
  detail: string;
  /** A device credential is stored on this phone. */
  paired: boolean;
  /** Notification access is switched on in system settings. */
  notificationAccessGranted: boolean;
  /** Epoch ms of the last accepted send; 0 when there has been none. */
  lastSuccessAtMs: number;
  /** Messages waiting to be sent. Counts only; content never leaves native. */
  pendingCount: number;
  /** Messages that could not be delivered after every retry. */
  deadCount: number;
};

export type PairResult = { ok: true } | { ok: false; message: string };

export type TestSendResult =
  | "ok"
  | "not_paired"
  | "reauthentication_required"
  | "rejected"
  | "unreachable";
