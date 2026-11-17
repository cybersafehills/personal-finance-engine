"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  getDevicePairingStatus,
  startDevicePairing,
} from "../app/integrations/connections/pair/actions";
import { CONNECT_SHORTCUT_NAME, devicePairShortcutRunUrl } from "../lib/pairing";

const POLL_MS = 2_500;

type Phase =
  | { kind: "intro" }
  | { kind: "creating" }
  | {
    kind: "waiting";
    token: string;
    sessionId: string;
    expiresAt: number;
    copied: boolean;
  }
  | { kind: "connected" }
  | { kind: "expired" }
  | { kind: "error"; message: string };

function mmss(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * One short flow to (re)connect a phone to an account that already has a
 * connection: make a one-time code → run the "Connect to OneLedger" Shortcut →
 * this screen turns green by itself. A successful re-pair gives the phone a
 * brand-new key and retires the old one, so it also fixes a phone that stopped
 * sending (see migration 20261127000000).
 */
export function ReconnectPhone({
  accountId,
  onClose,
}: {
  accountId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: "intro" });
  const [, startTransition] = useTransition();
  const [remaining, setRemaining] = useState<number | null>(null);

  const create = useCallback(() => {
    setPhase({ kind: "creating" });
    startTransition(async () => {
      const res = await startDevicePairing(accountId);
      if (!res.ok) {
        setPhase({ kind: "error", message: res.error });
        return;
      }
      // The Shortcut reads the code from the clipboard, so put it there now.
      let copied = false;
      try {
        await navigator.clipboard.writeText(res.token);
        copied = true;
      } catch {
        // Blocked: the code is on screen with a Copy button.
      }
      setPhase({
        kind: "waiting",
        token: res.token,
        sessionId: res.sessionId,
        expiresAt: Date.parse(res.expiresAt),
        copied,
      });
    });
  }, [accountId]);

  const waiting = phase.kind === "waiting" ? phase : null;
  const sessionId = waiting?.sessionId ?? null;
  const expiresAt = waiting?.expiresAt ?? null;

  // Watch for the phone redeeming the code.
  useEffect(() => {
    if (!sessionId || !expiresAt) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const res = await getDevicePairingStatus(sessionId);
      if (cancelled) return;
      if (res.ok && res.status === "consumed") {
        setPhase({ kind: "connected" });
        router.refresh();
        return;
      }
      if (
        (res.ok && (res.status === "expired" || res.status === "cancelled")) ||
        Date.now() >= expiresAt
      ) {
        setPhase({ kind: "expired" });
        return;
      }
      timer = setTimeout(tick, POLL_MS);
    };
    timer = setTimeout(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [sessionId, expiresAt, router]);

  // Countdown.
  useEffect(() => {
    if (!expiresAt) return;
    const update = () => setRemaining(expiresAt - Date.now());
    const first = setTimeout(update, 0);
    const id = setInterval(update, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [expiresAt]);

  const panel =
    "flex flex-col gap-3 rounded-control border border-border-subtle bg-background p-3";
  const primary =
    "inline-flex min-h-11 w-fit items-center justify-center rounded-control bg-accent px-4 text-sm font-medium text-accent-foreground disabled:opacity-50";
  const quiet = "min-h-9 text-xs font-medium text-text-muted hover:text-text-primary";

  if (phase.kind === "intro" || phase.kind === "creating") {
    return (
      <div className={panel} data-testid="reconnect-intro">
        <p className="text-sm font-medium text-text-primary">
          Reconnect this phone
        </p>
        <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm text-text-secondary">
          <li>We make a one-time code (works for 10 minutes).</li>
          <li>You run “{CONNECT_SHORTCUT_NAME}” on your iPhone.</li>
          <li>Your phone gets a new key. The old key stops working.</li>
        </ol>
        <p className="text-xs text-text-muted">
          Your transactions and settings stay as they are.
        </p>
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={create}
            disabled={phase.kind === "creating"}
            className={primary}
          >
            {phase.kind === "creating" ? "Making code…" : "Make my code"}
          </button>
          <button type="button" onClick={onClose} className={quiet}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (phase.kind === "waiting") {
    return (
      <div className={panel} data-testid="reconnect-waiting">
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium uppercase tracking-wide text-text-muted">
            Your code{remaining !== null ? ` · ${mmss(remaining)} left` : ""}
          </span>
          <code
            data-testid="pairing-code"
            className="block break-all rounded-control border border-border-strong bg-surface px-3 py-2 text-base font-semibold text-text-primary"
          >
            {phase.token}
          </code>
        </div>

        <p className="text-sm text-text-secondary">
          {phase.copied ? "Code copied. " : ""}
          Now open Shortcuts and run “{CONNECT_SHORTCUT_NAME}”.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <a
            href={devicePairShortcutRunUrl(phase.token)}
            className={primary}
          >
            Open the Shortcut
          </a>
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(phase.token);
                setPhase({ ...phase, copied: true });
              } catch {
                // Select the code above by hand.
              }
            }}
            className="min-h-11 rounded-control border border-border-strong px-4 text-sm font-medium text-text-primary"
          >
            {phase.copied ? "Copied ✓" : "Copy code"}
          </button>
        </div>

        <p
          role="status"
          className="flex items-center gap-2 text-xs text-text-secondary"
        >
          <span
            aria-hidden
            className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent"
          />
          Waiting for your phone… this turns green by itself.
        </p>
        <p className="text-xs text-text-muted">
          Shortcut named differently (like “{CONNECT_SHORTCUT_NAME} 1”)? Run
          that one instead.
        </p>
        <button type="button" onClick={onClose} className={`${quiet} w-fit`}>
          Cancel
        </button>
      </div>
    );
  }

  if (phase.kind === "connected") {
    return (
      <div
        role="status"
        data-testid="reconnect-done"
        className="flex flex-col items-center gap-2 rounded-control border border-border-subtle bg-background px-4 py-5 text-center"
      >
        <svg
          width="56"
          height="56"
          viewBox="0 0 72 72"
          fill="none"
          stroke="#16a34a"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="pay-mark-pop"
          aria-hidden="true"
        >
          <circle
            className="pay-mark-ring"
            cx="36"
            cy="36"
            r="30"
            transform="rotate(-90 36 36)"
          />
          <path className="pay-mark-glyph" d="M22 37l10 10 18-21" />
        </svg>
        <p className="text-base font-semibold text-text-primary">
          Phone connected
        </p>
        <p className="text-sm text-text-muted">
          Your next message will show up here in seconds.
        </p>
        <button type="button" onClick={onClose} className={primary}>
          Done
        </button>
      </div>
    );
  }

  if (phase.kind === "expired") {
    return (
      <div className={panel} data-testid="reconnect-expired">
        <p className="text-sm font-medium text-text-primary">
          That code ran out.
        </p>
        <p className="text-sm text-text-secondary">
          Codes work once and last 10 minutes. Make a fresh one.
        </p>
        <div className="flex items-center gap-4">
          <button type="button" onClick={create} className={primary}>
            Make a new code
          </button>
          <button type="button" onClick={onClose} className={quiet}>
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={panel} role="alert">
      <p className="text-sm text-attention">{phase.message}</p>
      <div className="flex items-center gap-4">
        <button type="button" onClick={create} className={primary}>
          Try again
        </button>
        <button type="button" onClick={onClose} className={quiet}>
          Close
        </button>
      </div>
    </div>
  );
}
