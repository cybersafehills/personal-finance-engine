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
  isQrDecodeSupported,
} from "../../lib/pay/scan/decode.client";
import { formatScanAmount } from "../../lib/pay/scan/money";
import { parseUserAmount } from "../../lib/pay/scan/handoff";
import { detectDialerCapability } from "../../lib/ussd/capability";
import {
  classifyScannedCode,
  prepareScanHandoff,
  recordScanHandoff,
  type ClassifyScanResult,
  type PrepareScanHandoffResult,
} from "../../app/pay/scan/actions";
import { CopyIcon, PayIcon, QrScanIcon } from "../icons";
import { PaymentQr } from "./PaymentQr";

const t = messages().pay.scan;

/**
 * Phases R1-R3 - the "Scan to pay" scanner. It opens the rear camera,
 * models every permission / device failure, decodes a QR (native
 * `BarcodeDetector` where present, else a jsQR canvas fallback - see
 * decode.client.ts) from camera frames or an uploaded image, classifies
 * the payload on the server, shows a mandatory review, and - only on an
 * explicit tap - creates a payment_intents draft (source=qr_scan) and
 * opens the USSD instruction on the device. It never dials on detection,
 * and it never claims the payment settled (the terminal state is
 * "Awaiting confirmation").
 *
 * Guarantees:
 *  - getUserMedia is only ever called from here, after an explicit
 *    "Scan to pay" tap (this component is lazy-mounted by that tap).
 *  - The MediaStream is released on unmount, on error, when the tab is
 *    hidden, when a QR is accepted, and when a fresh start supersedes an
 *    in-flight one.
 *  - Camera + decode state is conveyed as text (an aria-live status
 *    line), not by the video pixels alone.
 *  - The decoded string is classified AND prepared for hand-off through
 *    the shared, feature-gated server pipeline, re-parsed from the raw
 *    string - never a client-built model. R3 continues verified USSD
 *    instructions only.
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
  // QR-decode availability is a client fact known at first render - read
  // it in the initializer, not an effect. This component only ever mounts
  // client-side (lazy, after a tap), so the initializer runs in the
  // browser. In practice this is always true (any browser that can run
  // the camera can also draw a frame to a canvas for the jsQR fallback);
  // it flips false only if canvas 2D itself is unavailable.
  const [decoderSupported, setDecoderSupported] = useState(() =>
    typeof window === "undefined" ? true : isQrDecodeSupported(),
  );
  const decoderUnsupportedLoggedRef = useRef(false);
  const [multipleInView, setMultipleInView] = useState(false);
  const [imageMsg, setImageMsg] = useState<string | null>(null);
  const [result, setResult] = useState<ClassifyScanResult | null>(null);
  // The raw decoded string, kept so the review can ask the server to
  // prepare a hand-off by re-parsing it authoritatively (never a
  // client-built model).
  const [scannedRaw, setScannedRaw] = useState<string | null>(null);

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
        setScannedRaw(value);
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
    setScannedRaw(null);
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
  // start or a detect pass told us so. With the jsQR fallback this only
  // happens where canvas 2D itself is unavailable; the scanner is then
  // preview-only.
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
        <ScanResultView
          result={result}
          raw={scannedRaw}
          onScanAgain={scanAgain}
          onBack={onBack}
        />
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

function ScanNotice({
  children,
  onScanAgain,
  onBack,
}: {
  children: React.ReactNode;
  onScanAgain: () => void;
  onBack: () => void;
}) {
  const s = messages().pay.scan;
  return (
    <div className="flex flex-col items-center gap-3 rounded-card border border-border-subtle bg-background px-4 py-6 text-center">
      <QrScanIcon className="h-8 w-8 text-text-muted" />
      <p role="status" aria-live="polite" className="text-sm text-text-primary">
        {children}
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <button
          type="button"
          onClick={onScanAgain}
          className="min-h-11 rounded-control bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground"
        >
          {s.scanAgain}
        </button>
        <button
          type="button"
          onClick={onBack}
          className="min-h-11 rounded-control border border-border-subtle px-4 py-2 text-sm font-medium text-text-secondary hover:bg-surface"
        >
          {s.back}
        </button>
      </div>
    </div>
  );
}

type HandoffState =
  | { step: "review" }
  | { step: "preparing" }
  | { step: "ready"; intentId: string | null; telHref: string }
  | { step: "awaiting"; intentId: string | null }
  | { step: "unavailable"; reason: "route" | "currency" }
  | { step: "error" };

function ScanResultView({
  result,
  raw,
  onScanAgain,
  onBack,
}: {
  result: ClassifyScanResult | null;
  raw: string | null;
  onScanAgain: () => void;
  onBack: () => void;
}) {
  const r = messages().pay.scan.result;
  const s = messages().pay.scan;
  const [handoff, setHandoff] = useState<HandoffState>({ step: "review" });
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [amountInput, setAmountInput] = useState("");
  const [amountErr, setAmountErr] = useState<string | null>(null);
  const submittingRef = useRef(false);

  const AgainAndBack = (
    <div className="flex flex-wrap justify-center gap-2">
      <button
        type="button"
        onClick={onScanAgain}
        className="min-h-11 rounded-control bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground"
      >
        {s.scanAgain}
      </button>
      <button
        type="button"
        onClick={onBack}
        className="min-h-11 rounded-control border border-border-subtle px-4 py-2 text-sm font-medium text-text-secondary hover:bg-surface"
      >
        {s.back}
      </button>
    </div>
  );

  const notice = (body: React.ReactNode) => (
    <ScanNotice onScanAgain={onScanAgain} onBack={onBack}>
      {body}
    </ScanNotice>
  );

  if (!result || result.status === "error") return notice(r.genericError);
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
          {s.back}
        </button>
      </div>
    );
  }

  const scan = result.result;
  if (!scan.ok) return notice(r.reasons[scan.reason]);

  const m = scan.model;
  const isUssd = m.route.kind === "ussd" && m.route.literal != null;
  const isOneLedger = m.route.kind === "oneledger";
  const oneledgerCurrency = m.route.kind === "oneledger" ? m.route.currency : null;
  const dial = m.route.kind === "ussd" ? (m.route.literal ?? null) : null;
  const isMenu = isUssd && !m.amount; // a menu / inquiry code, not a payment
  // R3+ continues verified USSD, and OneLedger merchant payments in RWF
  // (mapped onto a pay-a-merchant USSD code server-side).
  const isActionable = isUssd || (isOneLedger && oneledgerCurrency === "RWF");
  const needsAmount = isOneLedger && m.amountEditable;
  const canDial =
    typeof navigator !== "undefined" &&
    detectDialerCapability(navigator.userAgent).canAttemptDialer;

  const rows: { label: string; value: string }[] = [];
  rows.push({ label: r.fieldRoute, value: r.classLabel[m.class] });
  if (m.providerLabel) rows.push({ label: r.fieldProvider, value: m.providerLabel });
  if (m.recipientMasked) rows.push({ label: r.fieldPays, value: m.recipientMasked });
  if (m.amount) rows.push({ label: r.fieldAmount, value: formatScanAmount(m.amount) });
  if (m.reference) rows.push({ label: r.fieldReference, value: m.reference });
  if (dial) rows.push({ label: r.fieldCode, value: dial });

  const Fields = (
    <div className="rounded-card border border-border-subtle bg-background p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
        {r.readTitle}
      </p>
      <dl className="mt-2 flex flex-col gap-1">
        {rows.map((row) => (
          <div key={row.label} className="flex justify-between gap-3 text-sm">
            <dt className="shrink-0 text-text-muted">{row.label}</dt>
            <dd className="min-w-0 break-all text-right font-medium text-text-primary">
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );

  const Warnings = (
    <>
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
      {isMenu && (
        <p className="rounded-control bg-background px-3 py-2 text-xs text-text-muted">
          {r.menuNote}
        </p>
      )}
    </>
  );

  // Not a route R3+ can continue (provider link, EMV, non-RWF OneLedger,
  // or a provider with no verified pay-merchant code yet).
  if (!isActionable) {
    return (
      <div className="flex flex-col gap-3">
        {Fields}
        {Warnings}
        <p className="rounded-control bg-background px-3 py-2 text-xs text-text-muted">
          {isOneLedger && oneledgerCurrency !== "RWF"
            ? r.currencyUnsupported
            : r.handoffUnavailable}
        </p>
        {AgainAndBack}
      </div>
    );
  }

  async function onPrepare() {
    if (submittingRef.current || !raw) return;

    let userAmountMinor: number | undefined;
    if (needsAmount) {
      const parsed = parseUserAmount(amountInput, "RWF");
      if (!parsed.ok) {
        setAmountErr(r.amountErrors[parsed.reason]);
        return;
      }
      userAmountMinor = parsed.minor;
    }
    setAmountErr(null);

    submittingRef.current = true;
    setHandoff({ step: "preparing" });
    let res: PrepareScanHandoffResult;
    try {
      res = await prepareScanHandoff(raw, userAmountMinor);
    } catch {
      res = { status: "error" };
    }
    submittingRef.current = false;
    if (res.status === "prepared") {
      setHandoff({ step: "ready", intentId: res.intentId, telHref: res.telHref });
    } else if (res.status === "info_only") {
      setHandoff({ step: "ready", intentId: null, telHref: res.telHref });
    } else if (res.status === "unsupported") {
      setHandoff({ step: "unavailable", reason: "route" });
    } else if (res.status === "currency_unsupported") {
      setHandoff({ step: "unavailable", reason: "currency" });
    } else if (res.status === "amount_required") {
      setAmountErr(r.amountErrors.required);
      setHandoff({ step: "review" });
    } else {
      setHandoff({ step: "error" });
    }
  }

  function onOpened(intentId: string | null, method: "dialer" | "copy") {
    trackScanEvent("scan_handoff_opened", { method });
    if (intentId) {
      void recordScanHandoff(
        intentId,
        method,
        method === "dialer" ? "dialer_opened" : "copied",
      );
    }
    setHandoff({ step: "awaiting", intentId });
  }

  async function onCopy(intentId: string | null, text: string) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
    if (intentId) void recordScanHandoff(intentId, "copy", "copied");
  }

  if (handoff.step === "awaiting") {
    return (
      <div className="flex flex-col gap-3">
        <div className="rounded-card border border-border-subtle bg-background p-4 text-center">
          <p className="text-sm font-semibold text-text-primary">{r.awaitingTitle}</p>
          <p className="mt-1 text-xs text-text-muted">{r.awaitingBody}</p>
        </div>
        {handoff.intentId && (
          <a
            href={`/pay/${handoff.intentId}`}
            className="mx-auto min-h-11 rounded-control border border-border-subtle px-4 py-2 text-center text-sm font-medium text-text-secondary hover:bg-surface"
          >
            {r.viewActivity}
          </a>
        )}
        {AgainAndBack}
      </div>
    );
  }

  if (handoff.step === "error") return notice(r.prepareError);
  if (handoff.step === "unavailable") {
    return notice(handoff.reason === "currency" ? r.currencyUnsupported : r.handoffUnavailable);
  }

  // The dial string shown / copied / QR-encoded on the ready step. USSD
  // has it client-side; OneLedger's is built server-side and comes back
  // only as the `tel:` href.
  const readyDial =
    handoff.step === "ready"
      ? handoff.telHref.replace(/^tel:/i, "").replace(/%23/g, "#")
      : (dial ?? "");

  return (
    <div className="flex flex-col gap-3">
      {Fields}
      {Warnings}
      <p className="rounded-control bg-background px-3 py-2 text-xs text-text-muted">
        {r.handoffNotice}
      </p>

      {handoff.step === "review" && (
        <>
          {needsAmount && (
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-text-primary">{r.amountLabel}</span>
              <input
                type="text"
                inputMode="numeric"
                value={amountInput}
                onChange={(e) => {
                  setAmountInput(e.target.value);
                  setAmountErr(null);
                }}
                className="min-h-11 rounded-control border border-border-subtle bg-background px-3 py-2 text-text-primary"
              />
              <span className="text-xs text-text-muted">{r.amountHint}</span>
              {amountErr && (
                <span role="alert" className="text-xs text-attention">
                  {amountErr}
                </span>
              )}
            </label>
          )}
          <button
            type="button"
            disabled={needsAmount && amountInput.trim() === ""}
            onClick={() => void onPrepare()}
            className="min-h-11 rounded-control bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground disabled:opacity-60"
          >
            {isMenu ? r.openMenu : r.prepareCta}
          </button>
          {AgainAndBack}
        </>
      )}

      {handoff.step === "preparing" && (
        <p role="status" aria-live="polite" className="text-center text-sm text-text-muted">
          {r.preparing}
        </p>
      )}

      {handoff.step === "ready" && (
        <>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => void onCopy(handoff.intentId, readyDial)}
              className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-control border border-border-subtle bg-surface px-4 py-2 text-sm font-medium text-text-primary"
            >
              <CopyIcon className="h-4 w-4" />
              {copied ? r.copied : r.copyCode}
            </button>
            {canDial ? (
              <a
                href={handoff.telHref}
                onClick={() => onOpened(handoff.intentId, "dialer")}
                className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-control bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground"
              >
                <PayIcon className="h-4 w-4" />
                {isMenu ? r.openMenu : r.openUssd}
              </a>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setShowQr((v) => !v);
                  onOpened(handoff.intentId, "copy");
                }}
                className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-control bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground"
              >
                {r.showQr}
              </button>
            )}
          </div>
          {!canDial && <p className="text-xs text-text-muted">{r.dialerUnavailable}</p>}
          {showQr && <PaymentQr value={handoff.telHref} label={r.qrCaption} />}
          {AgainAndBack}
        </>
      )}
    </div>
  );
}
