"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "../../lib/supabase/browser";

type Phase =
  | { kind: "loading" }
  | { kind: "challenge"; factorId: string }
  | { kind: "enroll"; factorId: string; qr: string; secret: string }
  | { kind: "error"; message: string };

// TOTP step-up. The database refuses every console RPC below aal2, so this is
// not decorative: until it succeeds the staff member sees no data.
export function MfaStep() {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = supabaseBrowser();
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (cancelled) return;
      if (error) return setPhase({ kind: "error", message: "Could not load verification options." });
      const verified = data.totp.find((f) => f.status === "verified");
      if (verified) return setPhase({ kind: "challenge", factorId: verified.id });
      // Clear any abandoned unverified enrolment before starting a new one.
      for (const f of data.all.filter((x) => x.status === "unverified")) {
        await supabase.auth.mfa.unenroll({ factorId: f.id });
      }
      const enrol = await supabase.auth.mfa.enroll({ factorType: "totp" });
      if (cancelled) return;
      if (enrol.error || !enrol.data) {
        return setPhase({ kind: "error", message: "Could not start authenticator setup." });
      }
      setPhase({
        kind: "enroll",
        factorId: enrol.data.id,
        qr: enrol.data.totp.qr_code,
        secret: enrol.data.totp.secret,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function verify(factorId: string) {
    setBusy(true);
    setError(null);
    const supabase = supabaseBrowser();
    const challenge = await supabase.auth.mfa.challenge({ factorId });
    if (challenge.error) {
      setBusy(false);
      return setError("Could not start verification. Try again.");
    }
    const res = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.data.id,
      code: code.trim(),
    });
    if (res.error) {
      setBusy(false);
      return setError("That code was not accepted. Check the time on your device and try again.");
    }
    // Hard navigation on purpose: the session just stepped up to aal2 and the
    // server must re-read the refreshed cookies from scratch.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/dashboard");
  }

  return (
    <div className="rounded-card border border-border bg-surface p-6 shadow-card">
      <h1 className="text-base font-semibold">Verify your identity</h1>
      {phase.kind === "loading" && <p className="mt-2 text-sm text-text-2">Loading…</p>}
      {phase.kind === "error" && (
        <p role="alert" className="mt-2 text-sm text-danger">{phase.message}</p>
      )}
      {(phase.kind === "challenge" || phase.kind === "enroll") && (
        <form
          className="mt-3 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void verify(phase.factorId);
          }}
        >
          {phase.kind === "enroll" && (
            <div className="space-y-2 text-sm text-text-2">
              <p>
                Console access requires an authenticator app. Scan this code,
                then enter the 6-digit code it shows.
              </p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={phase.qr} alt="Authenticator QR code" className="h-40 w-40 rounded-control border border-border" />
              <p className="break-all text-xs text-text-3">
                Manual key: <code>{phase.secret}</code>
              </p>
            </div>
          )}
          {phase.kind === "challenge" && (
            <p className="text-sm text-text-2">Enter the 6-digit code from your authenticator app.</p>
          )}
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
            aria-label="6-digit code"
            className="w-full rounded-control border border-border-strong bg-surface px-3 py-2 text-center text-lg tracking-widest"
          />
          {error ? (
            <p role="alert" className="rounded-control bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>
          ) : null}
          <button
            disabled={busy || code.trim().length !== 6}
            className="w-full rounded-control bg-accent px-3 py-2 text-sm font-medium text-accent-fg disabled:opacity-50"
          >
            {busy ? "Verifying…" : "Verify"}
          </button>
        </form>
      )}
    </div>
  );
}
