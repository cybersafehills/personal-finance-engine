import type {
  CaptureHealth,
  PairResult,
  TestSendResult,
} from "../../../modules/oneledger-capture";

// In-memory stand-in for the native capture engine, used ONLY by the
// browser development preview (see `captureIsDemo` in capture.ts). It makes
// no network calls and stores nothing. "Opening settings" simply flips the
// permission on, so every step of the connect flow can be walked through.

let paired = false;
let accessGranted = false;
let lastSuccessAtMs = 0;

function health(): CaptureHealth {
  const state = !paired
    ? "setup_required"
    : !accessGranted
      ? "permission_required"
      : "active";
  const detail = {
    setup_required: "Pair this phone with OneLedger to start.",
    permission_required:
      "Notification access is off. OneLedger can't see new transactions until you turn it back on.",
    active: "Connected. New transactions sync automatically.",
  }[state];
  return {
    state,
    detail,
    paired,
    notificationAccessGranted: accessGranted,
    lastSuccessAtMs,
    pendingCount: 0,
    deadCount: 0,
  };
}

export const demoEngine = {
  async getHealth(): Promise<CaptureHealth> {
    return health();
  },
  async pair(_input: string): Promise<PairResult> {
    paired = true;
    lastSuccessAtMs = Date.now();
    return { ok: true };
  },
  async sendTest(): Promise<TestSendResult> {
    if (!paired) return "not_paired";
    lastSuccessAtMs = Date.now();
    return "ok";
  },
  async disconnect(): Promise<void> {
    paired = false;
    accessGranted = false;
    lastSuccessAtMs = 0;
  },
  openNotificationAccessSettings(): void {
    accessGranted = true;
  },
};
