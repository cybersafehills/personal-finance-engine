"use client";

import type { RejectionReason } from "./types";

// Stage 2a - QR DECODE, browser side only. Uses the native
// `BarcodeDetector` (Chrome/Android, Safari 17+, most Android WebViews).
// There is intentionally NO heavy wasm decoder bundled in R2: where
// `BarcodeDetector` is missing the scanner degrades to preview-only and
// says so, and a decoder fallback is a later, measured decision.
//
// The image-upload path processes the file locally (createImageBitmap +
// detect) and never uploads it. Object URLs / bitmaps are released by
// the caller's `finally`.

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/bmp",
]);

type DetectedBarcode = { rawValue: string; format: string };
type BarcodeDetectorLike = {
  detect: (source: CanvasImageSource | ImageBitmap | Blob) => Promise<DetectedBarcode[]>;
};
type BarcodeDetectorCtor = {
  new (opts?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
};

export function isBarcodeDetectorSupported(): boolean {
  return typeof window !== "undefined" && "BarcodeDetector" in window;
}

function getDetector(): BarcodeDetectorLike | null {
  if (!isBarcodeDetectorSupported()) return null;
  const Ctor = (window as unknown as { BarcodeDetector: BarcodeDetectorCtor })
    .BarcodeDetector;
  try {
    return new Ctor({ formats: ["qr_code"] });
  } catch {
    // Some engines throw for an unsupported format list - fall back to
    // the default set.
    try {
      return new Ctor();
    } catch {
      return null;
    }
  }
}

export type DecodeOutcome =
  | { status: "decoded"; value: string }
  | { status: "none" }
  | { status: "multiple" }
  | { status: "unsupported" }
  | { status: "error"; reason: RejectionReason };

/** One detection pass over a live <video>. Returns quickly; the caller
 *  runs it on an interval and stops on the first `decoded`. */
export async function detectFromVideo(video: HTMLVideoElement): Promise<DecodeOutcome> {
  const detector = getDetector();
  if (!detector) return { status: "unsupported" };
  if (video.readyState < 2 || video.videoWidth === 0) return { status: "none" };
  try {
    const found = await detector.detect(video);
    const qrs = found.filter((b) => b.rawValue && b.rawValue.trim().length > 0);
    if (qrs.length === 0) return { status: "none" };
    if (qrs.length > 1) return { status: "multiple" };
    return { status: "decoded", value: qrs[0].rawValue };
  } catch {
    return { status: "none" };
  }
}

/** Decode a user-picked image file locally. Enforces type + size, then
 *  releases the bitmap. Never uploads. */
export async function detectFromImageFile(file: File): Promise<DecodeOutcome> {
  if (!isBarcodeDetectorSupported()) return { status: "unsupported" };
  if (file.size > MAX_IMAGE_BYTES) return { status: "error", reason: "too_long" };
  if (file.type && !ACCEPTED_IMAGE_TYPES.has(file.type)) {
    return { status: "error", reason: "not_recognised" };
  }

  const detector = getDetector();
  if (!detector) return { status: "unsupported" };

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
    const found = await detector.detect(bitmap);
    const qrs = found.filter((b) => b.rawValue && b.rawValue.trim().length > 0);
    if (qrs.length === 0) return { status: "none" };
    if (qrs.length > 1) return { status: "multiple" };
    return { status: "decoded", value: qrs[0].rawValue };
  } catch {
    return { status: "error", reason: "not_recognised" };
  } finally {
    bitmap?.close();
  }
}
