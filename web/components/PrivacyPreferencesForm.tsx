"use client";

import { useState, useTransition } from "react";
import { setHideBalance, setPrivacyMode } from "../app/settings/privacy/actions";

export function PrivacyPreferencesForm({
  initialHideBalance,
  initialPrivacyMode,
}: {
  initialHideBalance: boolean;
  initialPrivacyMode: boolean;
}) {
  const [hideBalance, setHideBalanceState] = useState(initialHideBalance);
  const [privacyMode, setPrivacyModeState] = useState(initialPrivacyMode);
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  function toggleHideBalance(next: boolean) {
    const previous = hideBalance;
    setHideBalanceState(next);
    setErrorMessage(null);
    startTransition(async () => {
      const result = await setHideBalance(next);
      if (result.ok) {
        setSavedAt(Date.now());
      } else {
        setHideBalanceState(previous);
        setErrorMessage(result.error);
      }
    });
  }

  function togglePrivacyMode(next: boolean) {
    const previous = privacyMode;
    setPrivacyModeState(next);
    setErrorMessage(null);
    startTransition(async () => {
      const result = await setPrivacyMode(next);
      if (result.ok) {
        setSavedAt(Date.now());
      } else {
        setPrivacyModeState(previous);
        setErrorMessage(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-4 rounded-card border border-border-subtle bg-surface p-4">
      <div>
        <p className="text-sm font-medium text-text-primary">Financial privacy</p>
        <p className="mt-0.5 text-sm text-text-muted">
          These control what OneLedger displays on screen for you - not who can sign
          in or what any report/export is allowed to include. They never change your
          account&apos;s access permissions.
        </p>
      </div>

      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          checked={hideBalance}
          onChange={(event) => toggleHideBalance(event.target.checked)}
          className="mt-0.5 h-5 w-5 shrink-0 accent-accent"
        />
        <span>
          <span className="block font-medium text-text-primary">
            Hide balance when OneLedger opens
          </span>
          <span className="block text-text-muted">
            Remembers the Current Balance card&apos;s hidden/shown state (the eye
            icon on the dashboard) across sessions and devices.
          </span>
        </span>
      </label>

      <label className="flex items-start gap-3 border-t border-border-subtle pt-4 text-sm">
        <input
          type="checkbox"
          checked={privacyMode}
          onChange={(event) => togglePrivacyMode(event.target.checked)}
          className="mt-0.5 h-5 w-5 shrink-0 accent-accent"
        />
        <span>
          <span className="block font-medium text-text-primary">
            Full financial privacy mode
          </span>
          <span className="block text-text-muted">
            Conceals every sensitive dashboard figure - current balance, today&apos;s
            received/spent totals, and the recent-transactions preview - not just the
            main balance. Reports and exports are unaffected; they follow their own
            sign-in and permission checks.
          </span>
        </span>
      </label>

      <div className="flex items-center gap-3 pt-1">
        {isPending && <span className="text-sm text-text-muted">Saving…</span>}
        {savedAt && !isPending && !errorMessage && (
          <span className="text-sm text-money-positive">Saved</span>
        )}
      </div>

      {errorMessage && (
        <p role="alert" className="text-sm text-attention">
          {errorMessage}
        </p>
      )}
    </div>
  );
}
