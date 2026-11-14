import OneLedgerCapture, {
  type CaptureHealth,
  type PairResult,
  type TestSendResult,
} from "../../../modules/oneledger-capture";

// App-facing wrapper around the native capture engine. Everything degrades
// to a safe value where the engine does not exist (iOS, web preview, or a
// build made without the native module), so screens never need to branch on
// platform themselves.

/** True only on an Android build that contains the capture engine. */
export const captureSupported = OneLedgerCapture !== null;

export async function getCaptureHealth(): Promise<CaptureHealth | null> {
  if (!OneLedgerCapture) return null;
  return OneLedgerCapture.getHealth();
}

export async function pairDevice(input: string): Promise<PairResult> {
  if (!OneLedgerCapture) {
    return {
      ok: false,
      message: "Recording money messages isn't available on this device.",
    };
  }
  return OneLedgerCapture.pair(input);
}

export async function sendCaptureTest(): Promise<TestSendResult | null> {
  if (!OneLedgerCapture) return null;
  return OneLedgerCapture.sendTest();
}

export async function disconnectDevice(): Promise<void> {
  await OneLedgerCapture?.disconnect();
}

export function openNotificationAccessSettings(): void {
  OneLedgerCapture?.openNotificationAccessSettings();
}

export type { CaptureHealth, CaptureHealthState } from "../../../modules/oneledger-capture";
