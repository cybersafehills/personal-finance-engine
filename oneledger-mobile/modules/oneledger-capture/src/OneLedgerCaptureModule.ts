import { NativeModule, requireOptionalNativeModule } from "expo";

import type {
  CaptureHealth,
  PairResult,
  TestSendResult,
} from "./OneLedgerCapture.types";

// The native capture engine's JS surface. Android only: iOS cannot observe
// other apps' notifications, and the web preview has no native code, so the
// module is null there and callers must handle that (see
// src/features/capture/capture.ts).
//
// By design nothing here returns the device secret, queue contents or any
// message text.
declare class OneLedgerCaptureModule extends NativeModule {
  isNotificationAccessGranted(): boolean;
  openNotificationAccessSettings(): void;
  extractPairingToken(raw: string): string | null;
  getHealth(): Promise<CaptureHealth>;
  pair(input: string): Promise<PairResult>;
  sendTest(): Promise<TestSendResult>;
  disconnect(): Promise<void>;
}

export default requireOptionalNativeModule<OneLedgerCaptureModule>(
  "OneLedgerCapture",
);
