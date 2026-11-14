import OneLedgerCapture, {
  type CaptureHealth,
  type PairResult,
  type TestSendResult,
} from "../../../modules/oneledger-capture";

import { Platform } from "react-native";

import { demoEngine } from "./demo-engine";

// App-facing wrapper around the native capture engine. Everything degrades
// to a safe value where the engine does not exist (iOS, or a build made
// without the native module), so screens never need to branch on platform
// themselves.

/**
 * In the browser development preview there is no native code, so the
 * connect flow could never be reviewed. There, and ONLY there (`__DEV__`
 * on web), an in-memory stand-in plays the engine's part. It never runs in
 * a phone build or a production bundle, sends nothing, and the UI labels it.
 */
export const captureIsDemo = __DEV__ && Platform.OS === "web";

type Engine = Pick<
  NonNullable<typeof OneLedgerCapture>,
  | "getHealth"
  | "pair"
  | "sendTest"
  | "disconnect"
  | "openNotificationAccessSettings"
>;

const engine: Engine | null = captureIsDemo ? demoEngine : OneLedgerCapture;

/** True on an Android build with the capture engine (or the web demo). */
export const captureSupported = engine !== null;

export async function getCaptureHealth(): Promise<CaptureHealth | null> {
  if (!engine) return null;
  return engine.getHealth();
}

export async function pairDevice(input: string): Promise<PairResult> {
  if (!engine) {
    return {
      ok: false,
      message: "Recording money messages isn't available on this device.",
    };
  }
  return engine.pair(input);
}

export async function sendCaptureTest(): Promise<TestSendResult | null> {
  if (!engine) return null;
  return engine.sendTest();
}

export async function disconnectDevice(): Promise<void> {
  await engine?.disconnect();
}

export function openNotificationAccessSettings(): void {
  engine?.openNotificationAccessSettings();
}

export type { CaptureHealth, CaptureHealthState } from "../../../modules/oneledger-capture";
