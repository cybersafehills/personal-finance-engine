"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { messages } from "../../lib/ussd/messages";
import {
  trackScanEvent,
  type ScanPermissionOutcome,
} from "../../lib/pay/scan-analytics";
import {
  detectFromImageFile,
  detectFromVideo,
  isBarcodeDetectorSupported,
} from "../../lib/pay/scan/decode.client";
import { formatScanAmount } from "../../lib/pay/scan/money";
import { classifyScannedCode, type ClassifyScanResult } from "../../app/pay/scan/actions";
import { QrScanIcon } from "../icons";

const t = messages().pay.scan;

/**
 * Phase R1 + R2 - the "Scan to pay" scanner. It opens the rear camera,
 * models every permission / device failure, decodes a QR with the native
 * `BarcodeDetector` (camera frames or an uploaded image), and classifies
 * the payload on the server. It STOPS at "here's what we read" - the
 * full review screen and the external hand-off are R3, and the copy
 * says so.
 *
 * Guarantees:
 *  - getUserMedia is only ever called from here, after an explicit
 *    "Scan to pay" tap (this component is lazy-mounted by that tap).
 *  - The MediaStream is released on unmount, on error, when the tab is
 *    hidden, when a QR is accepted, and when a fresh start supersedes an
 *    in-flight one.
 *  - Camera + decode state is conveyed as text (an aria-live status
 *    line), not by the video pixels alone.
 *  - The decoded string is classified through the shared, feature-gated
 *    pipeline. Nothing is dialled or handed off.
 */

type ScanErrorKind =
  | "denied"
  | "dismissed"
  | "noCamera"
  | "inUse"
  | "insecure"
  | "unsupported"
  | "generic";

type Phase = "starting" | "live" | "decoding" | "result" | "error";

const OUTCOME_BY_KIND: Record<ScanErrorKind, ScanPermissionOutcome> = {
  denied: "denied",
  dismissed: "dismissed",
  noCamera: "no_camera",
  inUse: "in_use",
  insecure: "insecure_context",
  unsupported: "unsupported",
  generic: "error",
};

function errName(err: unknown): string {
  return err && typeof err === "object" && "name" in err
    ? String((err as { name: unknown }).name)
    : "";
}

function isOverconstrained(err: unknown): boolean {
  const n = errName(err);
  return n === "OverconstrainedError" || n === "ConstraintNotSatisfiedError";
}

function classifyError(err: unknown): ScanErrorKind {
  switch (errName(err)) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return "denied";
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
    case "ConstraintNotSatisfiedError":
      return "noCamera";
    case "NotReadableError":
    case "TrackStartError":
      return "inUse";
    case "SecurityError":
      return "insecure";
    default:
      return "generic";
  }
}

export default function ScanToPay({ onBack }: { onBack: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mountedRef = useRef(false);
  // Bumped on every (re)start and whenever we leave the camera, so a
  // slow getUserMedia that resolves after we've moved on releases its
  // stream instead of attaching a second live camera.
  const startTokenRef = useRef(0);
  const phaseRef = useRef<Phase>("starting");
  // Reentrancy guard: one decode / classification at a time.
  const busyRef = useRef(false);

  const [phase, setPhase] = useState<Phase>("starting");
  const [errorKind, setErrorKind] = useState<ScanErrorKind | null>(null);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  // `BarcodeDetector` presence is a client fact known at first render -
  // read it in the initializer, not an effect. This component only ever
  // mounts client-side (lazy, after a tap), so the initializer runs in
  // the browser.
  const [decoderSupported, setDecoderSupported] = useState(() =>
    typeof window === "undefined" ? true : isBarcodeDetectorSupported(),
  );
  const decoderUnsupportedLoggedRef = useRef(false);
  const [multipleInView, setMultipleInView] = useState(false);
  const [imageMsg, setImageMsg] = useState<string | null>(null);
  const [result, setResult] = useState<ClassifyScanResult | null>(null);

  const statusId = useId();
  const guidanceId = useId();

  const stopStream = useCallback(() => {
    const s = streamRef.current;
    if (s) {
      for (const track of s.getTracks()) track.stop();
      streamRef.current = null;
    }
    const v = videoRef.current;
    if (v) {
      try {
        v.pause();
      } catch {
        /* not playing */
      }
      v.srcObject = null;
    }
  }, []);

  const fail = useCallback(
    (kind: ScanErrorKind) => {
      stopStream();
      if (!mountedRef.current) return;
      setTorchAvailable(false);
      setTorchOn(false);
      setPhase("error");
      setErrorKind(kind);
      trackScanEvent("scan_camera_permission", { outcome: OUTCOME_BY_KIND[kind] });
    },
    [stopStream],
  );

  const failFromError = useCallback(
    async (err: unknown) => {
      let kind = classifyError(err);
      if (kind === "denied" && typeof navigator !== "undefined" && navigator.permissions?.query) {
        try {
          const status = await navigator.permissions.query({
            name: "camera" as PermissionName,
          });
          if (status.state === "prompt") kind = "dismissed";
        } catch {
          /* camera not queryable here - keep "denied" */
        }
      }
      fail(kind);
    },
    [fail],
  );

  const start = useCallback(async () => {
    const token = ++startTokenRef.current;
    busyRef.current = false;
    if (mountedRef.current) {
      setPhase("starting");
      setErrorKind(null);
      setMultipleInView(false);
      setImageMsg(null);
    }

    if (typeof window !== "undefined" && window.isSecureContext === false) {
      fail("insecure");
      return;
    }
    const media = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
    if (!media || typeof media.getUserMedia !== "function") {
      fail("unsupported");
      return;
    }

    let stream: MediaStream;
    try {
      stream = await media.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
    } catch (err) {
      if (isOverconstrained(err)) {
        try {
          stream = await media.getUserMedia({ video: true, audio: false });
        } catch (err2) {
          await failFromError(err2);
          return;
        }
      } else {
        await failFromError(err);
        return;
      }
    }

    if (!mountedRef.current || token !== startTokenRef.current) {
      for (const track of stream.getTracks()) track.stop();
      return;
    }

    streamRef.current = stream;
    const video = videoRef.current;
    if (video) {
      video.srcObject = stream;
      try {
        await video.play();
      } catch {
        /* autoplay restrictions - the frame may still paint */
      }
    }

    const track = stream.getVideoTracks()[0];
    const caps =
      track && typeof track.getCapabilities === "function"
        ? (track.getCapabilities() as unknown as { torch?: boolean })
        : undefined;
    const hasTorch = Boolean(caps?.torch);

    if (!mountedRef.current || token !== startTokenRef.current) {
      stopStream();
      return;
    }
    setTorchAvailable(hasTorch);
    setTorchOn(false);
    setPhase("live");
    trackScanEvent("scan_camera_permission", { outcome: "granted" });
    trackScanEvent("scan_camera_started", { torch_available: hasTorch });
  }, [fail, failFromError, stopStream]);

  const toggleTorch = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({
        advanced: [{ torch: next } as unknown as MediaTrackConstraintSet],
      });
      setTorchOn(next);
      trackScanEvent("scan_torch_toggled", { on: next });
    } catch {
      setTorchAvailable(false);
    }
  }, [torchOn]);

  const handleDecoded = useCallback(
    async (value: string, source: "camera" | "image") => {
      if (busyRef.current) return;
      busyRef.current = true;
      trackScanEvent("scan_qr_detected", { source });
      // Leave the camera before the round-trip (§4.2 "stop the camera and
      // show a mandatory review").
      startTokenRef.current++;
      stopStream();
      if (mountedRef.current) {
        setMultipleInView(false);
        setImageMsg(null);
        setPhase("decoding");
      }
      let res: ClassifyScanResult;
      try {
        res = await classifyScannedCode(value);
      } catch {
        res = { status: "error" };
      }
      if (!mountedRef.current) return;
      setResult(res);
      setPhase("result");
      busyRef.current = false;
    },
    [stopStream],
  );

  const scanAgain = useCallback(() => {
    trackScanEvent("scan_again");
    setResult(null);
    setImageMsg(null);
    setMultipleInView(false);
    busyRef.current = false;
    void start();
  }, [start]);

  const onPickImage = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      trackScanEvent("scan_image_selected");
      setImageMsg(null);
      const outcome = await detectFromImageFile(file);
      if (!mountedRef.current) return;
      switch (outcome.status) {
        case "decoded":
          await handleDecoded(outcome.value, "image");
          return;
        case "multiple":
          setImageMsg(t.multiple);
          return;
        case "unsupported":
          setDecoderSupported(false);
          return;
        default:
          setImageMsg(t.uploadNoCode);
      }
    },
    [handleDecoded],
  );

  // Report an unsupported decoder once - whether it was missing from the
  // start or a detect pass told us so. `BarcodeDetector` is the only
  // decoder in R2; where it's missing the scanner is preview-only.
  useEffect(() => {
    if (!decoderSupported && !decoderUnsupportedLoggedRef.current) {
      decoderUnsupportedLoggedRef.current = true;
      trackScanEvent("scan_decoder_unsupported");
    }
  }, [decoderSupported]);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    mountedRef.current = true;
    void start();

    const onVisibility = () => {
      if (typeof document === "undefined") return;
      if (document.hidden) {
        startTokenRef.current++;
        stopStream();
        if (mountedRef.current && phaseRef.current === "live") setPhase("starting");
      } else if (mountedRef.current && phaseRef.current === "starting") {
        void start();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      // Clearing mountedRef is enough to neutralise any in-flight
      // start() - every post-await step re-checks it.
      mountedRef.current = false;
      document.removeEventListener("visibilitychange", onVisibility);
      stopStream();
    };
    // start / stopStream are stable (useCallback with ref-only deps).
  }, [start, stopStream]);

  // Detection loop - runs only while the camera is live and a decoder is
  // available. Stops on the first single QR; a multi-QR frame just nudges
  // the user (never picks one silently, §4.4).
  useEffect(() => {
    if (phase !== "live" || !decoderSupported) return;
    let cancelled = false;
    const id = window.setInterval(async () => {
      if (cancelled || busyRef.current) return;
      const video = videoRef.current;
      if (!video) return;
      busyRef.current = true;
      const outcome = await detectFromVideo(video);
      busyRef.current = false;
      if (cancelled) return;
      if (outcome.status === "decoded") {
        void handleDecoded(outcome.value, "camera");
      } else if (outcome.status === "multiple") {
        setMultipleInView(true);
      } else if (outcome.status === "unsupported") {
        setDecoderSupported(false);
      } else if (outcome.status === "none") {
        setMultipleInView(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [phase, decoderSupported, handleDecoded]);

  const liveStatus = !decoderSupported
    ? t.decoderUnsupported
    : multipleInView
      ? t.multiple
      : t.live;
  const statusText =
    phase === "live"
      ? liveStatus
      : phase === "starting"
        ? t.starting
        : phase === "decoding"
          ? t.checking
          : errorKind
            ? t.errors[errorKind]
            : t.errors.generic;

  const showUpload = decoderSupported && (phase === "live" || phase === "error");

  return (
    <div className="flex flex-col gap-3">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/bmp"
        className="hidden"
        onChange={onPickImage}
      />

      {phase !== "result" && (
        <p id={guidanceId} className="text-sm text-text-secondary">
          {t.guidance}
        </p>
      )}

      {phase === "result" ? (
        <ScanResultView result={result} onScanAgain={scanAgain} onBack={onBack} />
      ) : phase === "error" ? (
        <div
          className="flex flex-col items-center gap-3 rounded-card border border-border-subtle bg-background px-4 py-6 text-center"
          role="group"
          aria-label={t.title}
        >
          <QrScanIcon className="h-8 w-8 text-text-muted" />
          <p id={statusId} role="status" aria-live="polite" className="text-sm text-text-primary">
            {statusText}
          </p>
          {(errorKind === "denied" || errorKind === "dismissed") && (
            <details className="w-full text-left">
              <summary className="cursor-pointer text-xs font-medium text-accent">
                {t.permissionHelp}
              </summary>
              <p className="mt-1.5 text-xs text-text-muted">{t.permissionHelpBody}</p>
            </details>
          )}
          {imageMsg && <p className="text-xs text-text-muted">{imageMsg}</p>}
          <div className="flex flex-wrap justify-center gap-2">
            {errorKind !== "insecure" && errorKind !== "unsupported" && (
              <button
                type="button"
                onClick={() => void start()}
                className="min-h-11 rounded-control bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground"
              >
                {t.retry}
              </button>
            )}
            {showUpload && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="min-h-11 rounded-control border border-border-subtle px-4 py-2 text-sm font-medium text-text-secondary hover:bg-surface"
              >
                {t.uploadImage}
              </button>
            )}
            <button
              type="button"
              onClick={onBack}
              className="min-h-11 rounded-control border border-border-subtle px-4 py-2 text-sm font-medium text-text-secondary hover:bg-surface"
            >
              {t.back}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="relative mx-auto aspect-square w-full max-w-xs overflow-hidden rounded-card border border-border-subtle bg-black">
            <video
              ref={videoRef}
              playsInline
              muted
              aria-hidden="true"
              className="h-full w-full object-cover"
            />
            <div aria-hidden="true" className="pointer-events-none absolute inset-0">
              <span className="absolute left-5 top-5 h-7 w-7 border-l-2 border-t-2 border-white/80" />
              <span className="absolute right-5 top-5 h-7 w-7 border-r-2 border-t-2 border-white/80" />
              <span className="absolute bottom-5 left-5 h-7 w-7 border-b-2 border-l-2 border-white/80" />
              <span className="absolute bottom-5 right-5 h-7 w-7 border-b-2 border-r-2 border-white/80" />
            </div>
            {(phase === "starting" || phase === "decoding") && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                <span className="animate-pulse text-xs font-medium text-white">
                  {phase === "decoding" ? t.checking : t.starting}
                </span>
              </div>
            )}
          </div>

          <p
            id={statusId}
            role="status"
            aria-live="polite"
            aria-describedby={guidanceId}
            className="text-center text-sm text-text-muted"
          >
            {statusText}
          </p>

          {imageMsg && (
            <p className="text-center text-xs text-text-muted">{imageMsg}</p>
          )}

          <div className="flex flex-wrap justify-center gap-2">
            {phase === "live" && torchAvailable && (
              <button
                type="button"
                onClick={() => void toggleTorch()}
                aria-pressed={torchOn}
                className="min-h-11 rounded-control border border-border-subtle px-4 py-2 text-sm font-medium text-text-secondary hover:bg-background"
              >
                {torchOn ? t.torchOff : t.torchOn}
              </button>
            )}
            {showUpload && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="min-h-11 rounded-control border border-border-subtle px-4 py-2 text-sm font-medium text-text-secondary hover:bg-background"
              >
                {t.uploadImage}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function ScanResultView({
  result,
  onScanAgain,
  onBack,
}: {
  result: ClassifyScanResult | null;
  onScanAgain: () => void;
  onBack: () => void;
}) {
  const r = messages().pay.scan.result;

  const AgainAndBack = (
    <div className="flex flex-wrap justify-center gap-2">
      <button
        type="button"
        onClick={onScanAgain}
        className="min-h-11 rounded-control bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground"
      >
        {messages().pay.scan.scanAgain}
      </button>
      <button
        type="button"
        onClick={onBack}
        className="min-h-11 rounded-control border border-border-subtle px-4 py-2 text-sm font-medium text-text-secondary hover:bg-surface"
      >
        {messages().pay.scan.back}
      </button>
    </div>
  );

  if (!result || result.status === "error") {
    return (
      <div className="flex flex-col items-center gap-3 rounded-card border border-border-subtle bg-background px-4 py-6 text-center">
        <p role="status" aria-live="polite" className="text-sm text-text-primary">
          {r.genericError}
        </p>
        {AgainAndBack}
      </div>
    );
  }

  if (result.status === "feature_disabled") {
    return (
      <div className="flex flex-col items-center gap-3 rounded-card border border-border-subtle bg-background px-4 py-6 text-center">
        <p role="status" aria-live="polite" className="text-sm text-text-primary">
          {r.featureDisabled}
        </p>
        <button
          type="button"
          onClick={onBack}
          className="min-h-11 rounded-control border border-border-subtle px-4 py-2 text-sm font-medium text-text-secondary hover:bg-surface"
        >
          {messages().pay.scan.back}
        </button>
      </div>
    );
  }

  const scan = result.result;
  if (!scan.ok) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-card border border-border-subtle bg-background px-4 py-6 text-center">
        <QrScanIcon className="h-8 w-8 text-text-muted" />
        <p role="status" aria-live="polite" className="text-sm text-text-primary">
          {r.reasons[scan.reason]}
        </p>
        {AgainAndBack}
      </div>
    );
  }

  const m = scan.model;
  const rows: { label: string; value: string }[] = [];
  if (m.providerLabel) rows.push({ label: r.fieldProvider, value: m.providerLabel });
  if (m.recipientMasked) rows.push({ label: r.fieldPays, value: m.recipientMasked });
  if (m.amount) rows.push({ label: r.fieldAmount, value: formatScanAmount(m.amount) });
  if (m.reference) rows.push({ label: r.fieldReference, value: m.reference });

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-card border border-border-subtle bg-background p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
          {r.readTitle}
        </p>
        <p className="mt-0.5 text-sm font-semibold text-text-primary">
          {r.classLabel[m.class]}
        </p>
        {rows.length > 0 && (
          <dl className="mt-2 flex flex-col gap-1">
            {rows.map((row) => (
              <div key={row.label} className="flex justify-between gap-3 text-sm">
                <dt className="text-text-muted">{row.label}</dt>
                <dd className="min-w-0 truncate text-right text-text-primary">{row.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      {m.warnings.includes("merchant_unverified") && (
        <p className="rounded-control bg-background px-3 py-2 text-xs text-text-muted">
          {r.merchantUnverified}
        </p>
      )}
      {m.warnings.includes("ussd_not_officially_verified") && (
        <p className="rounded-control bg-background px-3 py-2 text-xs text-text-muted">
          {r.ussdUnverified}
        </p>
      )}
      {(m.warnings.includes("amount_missing") || m.amountEditable) && (
        <p className="rounded-control bg-background px-3 py-2 text-xs text-text-muted">
          {r.amountMissing}
        </p>
      )}

      <button
        type="button"
        disabled
        aria-disabled="true"
        title={r.reviewComingSoon}
        className="min-h-11 rounded-control bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground opacity-60"
      >
        {r.reviewCta}
      </button>
      <p className="text-center text-xs text-text-muted">{r.reviewComingSoon}</p>

      {AgainAndBack}
    </div>
  );
}
