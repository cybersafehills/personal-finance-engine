"use client";

import { useState } from "react";
import { supabaseBrowser } from "../lib/supabase-browser";
import { internalRedirectPath } from "../lib/internal-redirect";

type ChallengeFactor = { id: string; name: string };

export function MfaChallenge({
  factors,
  next,
}: {
  factors: ChallengeFactor[];
  next: string;
}) {
  const [factorId, setFactorId] = useState(factors[0]?.id ?? "");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function verify() {
    setBusy(true);
    setError(null);
    const { error: verifyError } = await supabaseBrowser().auth.mfa
      .challengeAndVerify({ factorId, code: code.replace(/\s/g, "") });
    if (verifyError) {
      setBusy(false);
      setError(
        "That code was not accepted. Try the current code from your authenticator.",
      );
      return;
    }
    window.location.assign(internalRedirectPath(next));
  }

  return (
    <div className="flex flex-col gap-4 rounded-card border border-border-subtle bg-surface p-5">
      {factors.length > 1 && (
        <label className="flex flex-col gap-1 text-sm text-text-secondary">
          Authenticator
          <select
            value={factorId}
            onChange={(event) => setFactorId(event.target.value)}
            className="min-h-11 rounded-control border border-border-strong bg-background px-3 text-base text-text-primary"
          >
            {factors.map((factor) => (
              <option key={factor.id} value={factor.id}>{factor.name}</option>
            ))}
          </select>
        </label>
      )}
      <label className="flex flex-col gap-1 text-sm text-text-secondary">
        Six-digit authenticator code
        <input
          autoFocus
          value={code}
          onChange={(event) => setCode(event.target.value)}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={8}
          className="min-h-11 rounded-control border border-border-strong bg-background px-3 text-base text-text-primary"
        />
      </label>
      <button
        type="button"
        disabled={busy || !factorId || code.replace(/\s/g, "").length < 6}
        onClick={verify}
        className="min-h-11 rounded-control bg-accent px-4 text-sm font-medium text-white disabled:opacity-50"
      >
        {busy ? "Verifying…" : "Verify and continue"}
      </button>
      {error && <p role="alert" className="text-sm text-attention">{error}</p>}
    </div>
  );
}
