"use client";

import jsQR from "jsqr";
import type { RejectionReason } from "./types.ts";

// Stage 2a - QR DECODE, browser side only.
//
// Two decoders, tried in order:
//   1. Native `BarcodeDetector` - fast, hardware-backed. Blink only
//      (Chrome / Edge desktop, Chrome + WebView on Android).
//   2. `jsQR` fallback - a canvas frame is grayscaled and decoded in JS.
//      This is the ONLY path that runs on iOS (every iOS browser is
//      WebKit and WebKit has never shipped BarcodeDetector), desktop
//      Safari, and Firefox. It is pure JS - no wasm, no worker, no
//      network - so it is CSP-safe and works offline.
//
// The image-upload path processes the file locally (createImageBitmap /
// <img> + canvas) and never uploads it.

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/bmp",
]);

// jsQR cost is O(pixels). Downscale the live camera frame to this longest
// edge before each pass so a scan stays well under the ~350ms loop
// interval even on a mid-range phone; a payment QR still resolves at this
// size. The one-shot image-upload path is allowed a larger budget.
const LIVE_SCAN_MAX_DIM = 640;
const IMAGE_SCAN_MAX_DIM = 2000;

type DetectedBarcode = { rawValue: string; format: string };
type BarcodeDetectorLike = {
  detect: (source: CanvasImageSource | ImageBitmap | Blob) => Promise<DetectedBarcode[]>;
};
type BarcodeDetectorCtor = {
  new (opts?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
};

/** True where the browser exposes the native `BarcodeDetector` (Blink). */
export function isNativeBarcodeDetectorSupported(): boolean {
  return typeof window !== "undefined" && "BarcodeDetector" in window;
}

/** QR decoding is available on every browser that can draw a video frame
 *  or an image to a 2D canvas - i.e. everywhere the camera itself works.
 *  The scanner only degrades to preview-only if even that is missing. */
export function isQrDecodeSupported(): boolean {
  if (typeof document === "undefined") return false;
  if (isNativeBarcodeDetectorSupported()) return true;
  try {
    return document.createElement("canvas").getContext("2d") != null;
  } catch {
    return false;
  }
}

function getNativeDetector(): BarcodeDetectorLike | null {
  if (!isNativeBarcodeDetectorSupported()) return null;
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

// One reused scratch canvas for the whole session - the live loop would
// otherwise allocate a canvas every 350ms.
let scratch: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null = null;
function scratchCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  if (scratch) return scratch;
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  scratch = { canvas, ctx };
  return scratch;
}

/** Draw `source` (already-decoded pixels) to the scratch canvas, capped
 *  at `maxDim` on its longest edge, and run jsQR over the result. */
function decodeWithJsQr(
  source: CanvasImageSource,
  srcWidth: number,
  srcHeight: number,
  maxDim: number,
): DecodeOutcome {
  if (srcWidth === 0 || srcHeight === 0) return { status: "none" };
  const sc = scratchCanvas();
  if (!sc) return { status: "unsupported" };

  const scale = Math.min(1, maxDim / Math.max(srcWidth, srcHeight));
  const w = Math.max(1, Math.round(srcWidth * scale));
  const h = Math.max(1, Math.round(srcHeight * scale));
  sc.canvas.width = w;
  sc.canvas.height = h;
  sc.ctx.drawImage(source, 0, 0, w, h);

  let pixels: ImageData;
  try {
    pixels = sc.ctx.getImageData(0, 0, w, h);
  } catch {
    // Tainted canvas - only possible with a cross-origin source, which
    // this module never has (own camera / user-picked file).
    return { status: "error", reason: "not_recognised" };
  }

  const found = jsQR(pixels.data, w, h, { inversionAttempts: "attemptBoth" });
  const value = found?.data;
  if (!value || value.trim().length === 0) return { status: "none" };
  return { status: "decoded", value };
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
  if (video.readyState < 2 || video.videoWidth === 0) return { status: "none" };

  const detector = getNativeDetector();
  if (detector) {
    try {
      const found = await detector.detect(video);
      const qrs = found.filter((b) => b.rawValue && b.rawValue.trim().length > 0);
      if (qrs.length > 1) return { status: "multiple" };
      if (qrs.length === 1) return { status: "decoded", value: qrs[0].rawValue };
      // No native hit - fall through to jsQR on the same frame. Native
      // occasionally misses angles/glare that jsQR's inversion pass gets.
    } catch {
      // Native detector threw - let jsQR try.
    }
  }

  try {
    return decodeWithJsQr(video, video.videoWidth, video.videoHeight, LIVE_SCAN_MAX_DIM);
  } catch {
    return { status: "none" };
  }
}

/** Decode a user-picked image file locally. Enforces type + size. Never
 *  uploads. */
export async function detectFromImageFile(file: File): Promise<DecodeOutcome> {
  if (file.size > MAX_IMAGE_BYTES) return { status: "error", reason: "too_long" };
  if (file.type && !ACCEPTED_IMAGE_TYPES.has(file.type)) {
    return { status: "error", reason: "not_recognised" };
  }

  const detector = getNativeDetector();
  if (detector) {
    let bitmap: ImageBitmap | null = null;
    try {
      bitmap = await createImageBitmap(file);
      const found = await detector.detect(bitmap);
      const qrs = found.filter((b) => b.rawValue && b.rawValue.trim().length > 0);
      if (qrs.length > 1) return { status: "multiple" };
      if (qrs.length === 1) return { status: "decoded", value: qrs[0].rawValue };
    } catch {
      // fall through to jsQR
    } finally {
      bitmap?.close();
    }
  }

  // jsQR path: decode the file to pixels via createImageBitmap, falling
  // back to <img> for engines whose createImageBitmap(File) is flaky.
  let source: CanvasImageSource | null = null;
  let width = 0;
  let height = 0;
  let objectUrl: string | null = null;
  try {
    try {
      const bitmap = await createImageBitmap(file);
      source = bitmap;
      width = bitmap.width;
      height = bitmap.height;
    } catch {
      objectUrl = URL.createObjectURL(file);
      const img = new Image();
      img.decoding = "sync";
      img.src = objectUrl;
      await img.decode();
      source = img;
      width = img.naturalWidth;
      height = img.naturalHeight;
    }
    return decodeWithJsQr(source, width, height, IMAGE_SCAN_MAX_DIM);
  } catch {
    return { status: "error", reason: "not_recognised" };
  } finally {
    if (source && "close" in source && typeof source.close === "function") {
      (source as ImageBitmap).close();
    }
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}
