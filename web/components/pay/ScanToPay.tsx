"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { messages } from "../../lib/ussd/messages";
import {
  trackScanEvent,
  type ScanPermissionOutcome,
} from "../../lib/pay/scan-analytics";
import { QrScanIcon } from "../icons";

const t = messages().pay.scan;

/**
 * Phase R1 - the "Scan to pay" camera SHELL. It opens the rear camera,
 * renders a live preview + viewfinder, exposes a torch toggle where the
 * device supports it, and models every failure the platform can throw
 * (permission denied / dismissed, no camera, camera busy, insecure
 * context, unsupported browser). It does NOT decode a QR code, parse a
 * payload, or hand off to any payment channel - that is a later phase,
 * and the on-screen notice says so.
 *
 * Guarantees:
 *  - getUserMedia is only ever called from here, i.e. after the user has
 *    explicitly tapped "Scan to pay" (this component is lazy-mounted by
 *    that tap). Never on app start or on the Pay sheet merely opening.
 *  - The MediaStream is released on unmount, on error, when the tab is
 *    hidden, and whenever a fresh start supersedes an in-flight one.
 *  - Camera state is conveyed as text (an aria-live status line), not by
 *    the video pixels alone.
 *
 * Rendered inside the Pay launcher dialog; the dialog owns the header
 * (Back + title) and the footer (Close), so this component is body
 * content only.
 */

type ScanErrorKind =
  | "denied"
  | "dismissed"
  | "noCamera"
  | "inUse"
  | "insecure"
  | "unsupported"
  | "generic";

type Phase = "starting" | "live" | "error";

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
  const streamRef = useRef<MediaStream | null>(null);
  const mountedRef = useRef(false);
  // Bumped on every (re)start and on unmount, so a slow getUserMedia that
  // resolves after we've moved on releases its stream instead of
  // attaching a second live camera.
  const startTokenRef = useRef(0);
  // `phase` mirrored into a ref so the visibilitychange handler can read
  // the current phase without being re-bound every time it changes.
  const phaseRef = useRef<Phase>("starting");

  const [phase, setPhase] = useState<Phase>("starting");
  const [errorKind, setErrorKind] = useState<ScanErrorKind | null>(null);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

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
      // A rejected getUserMedia with NotAllowedError covers BOTH a hard
      // block and a prompt the user dismissed. Where the browser exposes
      // it, tell them apart so the recovery copy is right.
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
    if (mountedRef.current) {
      setPhase("starting");
      setErrorKind(null);
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
        // No camera matched the rear-facing hint - retry unconstrained
        // before deciding there's no usable camera at all.
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

    // Superseded (unmounted, or a newer start ran) while we awaited.
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
      // The device advertised torch but won't apply it - hide the control.
      setTorchAvailable(false);
    }
  }, [torchOn]);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    mountedRef.current = true;
    void start();

    const onVisibility = () => {
      if (typeof document === "undefined") return;
      if (document.hidden) {
        // Free the camera while backgrounded; resume when we return.
        startTokenRef.current++;
        stopStream();
        if (mountedRef.current) setPhase("starting");
      } else if (mountedRef.current && phaseRef.current !== "error") {
        void start();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      // Clearing mountedRef is enough to neutralise any in-flight
      // start() - every post-await step re-checks it before touching
      // state or the stream.
      mountedRef.current = false;
      document.removeEventListener("visibilitychange", onVisibility);
      stopStream();
    };
    // start / stopStream are stable (useCallback with ref-only deps).
  }, [start, stopStream]);

  const statusText =
    phase === "live"
      ? t.live
      : phase === "starting"
        ? t.starting
        : errorKind
          ? t.errors[errorKind]
          : t.errors.generic;

  return (
    <div className="flex flex-col gap-3">
      <p id={guidanceId} className="text-sm text-text-secondary">
        {t.guidance}
      </p>

      {phase === "error" ? (
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
            {/* Decorative viewfinder brackets. */}
            <div aria-hidden="true" className="pointer-events-none absolute inset-0">
              <span className="absolute left-5 top-5 h-7 w-7 border-l-2 border-t-2 border-white/80" />
              <span className="absolute right-5 top-5 h-7 w-7 border-r-2 border-t-2 border-white/80" />
              <span className="absolute bottom-5 left-5 h-7 w-7 border-b-2 border-l-2 border-white/80" />
              <span className="absolute bottom-5 right-5 h-7 w-7 border-b-2 border-r-2 border-white/80" />
            </div>
            {phase === "starting" && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                <span className="animate-pulse text-xs font-medium text-white">
                  {t.starting}
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

          {phase === "live" && torchAvailable && (
            <button
              type="button"
              onClick={() => void toggleTorch()}
              aria-pressed={torchOn}
              className="mx-auto min-h-11 rounded-control border border-border-subtle px-4 py-2 text-sm font-medium text-text-secondary hover:bg-background"
            >
              {torchOn ? t.torchOff : t.torchOn}
            </button>
          )}
        </>
      )}

      <p className="rounded-control bg-background px-3 py-2 text-xs text-text-muted">
        {t.shellNotice}
      </p>
    </div>
  );
}
