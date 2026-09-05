"use client";

import { useRef, useState } from "react";

// One consistent confirmation gate for irreversible / sensitive actions:
// revoke a connection, unlink a source, remove a member, delete, rotate a
// credential (master prompt "DestructiveConfirm" / assessment section
// 6.1). Renders a trigger button; on click it opens a small confirm panel
// that must be explicitly accepted. For the highest-risk actions, pass
// `confirmWord` to require the user to type it first, and/or `mfaNotice`
// to show that a step-up will follow.
//
// This is UX friction only - the server action it calls remains the
// authority and must do its own capability + MFA-assurance check.

export function DestructiveConfirm({
  triggerLabel,
  title,
  body,
  confirmLabel = "Confirm",
  confirmWord,
  mfaNotice,
  onConfirm,
  disabled = false,
}: {
  triggerLabel: string;
  title: string;
  body: string;
  confirmLabel?: string;
  /** When set, the user must type this exact string to enable Confirm. */
  confirmWord?: string;
  /** Shown when the real action will additionally prompt for MFA. */
  mfaNotice?: string;
  onConfirm: () => void | Promise<void>;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);

  const canConfirm = !busy && (!confirmWord || typed === confirmWord);

  async function run() {
    if (!canConfirm) return;
    setBusy(true);
    try {
      await onConfirm();
      setOpen(false);
      setTyped("");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="min-h-11 rounded-control border border-border-strong px-3 text-sm font-medium text-attention hover:bg-attention-bg disabled:opacity-50"
      >
        {triggerLabel}
      </button>
    );
  }

  return (
    <div
      role="alertdialog"
      aria-modal="false"
      aria-label={title}
      className="flex flex-col gap-2 rounded-card border border-attention bg-attention-bg p-4"
    >
      <p className="text-sm font-semibold text-text-primary">{title}</p>
      <p className="text-sm text-text-secondary">{body}</p>
      {mfaNotice && (
        <p className="text-xs text-text-muted">{mfaNotice}</p>
      )}
      {confirmWord && (
        <label className="mt-1 flex flex-col gap-1 text-xs font-medium text-text-secondary">
          Type <span className="font-mono text-text-primary">{confirmWord}</span>
          {" "}to confirm
          <input
            type="text"
            autoComplete="off"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            className="min-h-11 rounded-control border border-border-strong bg-surface px-3 py-2 text-text-primary"
          />
        </label>
      )}
      <div className="mt-1 flex items-center gap-2">
        <button
          ref={confirmRef}
          type="button"
          disabled={!canConfirm}
          onClick={run}
          className="min-h-11 rounded-control bg-attention px-3 text-sm font-semibold text-surface disabled:opacity-50"
        >
          {busy ? "Working…" : confirmLabel}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setOpen(false);
            setTyped("");
          }}
          className="min-h-11 rounded-control px-3 text-sm font-medium text-text-secondary hover:text-text-primary"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
