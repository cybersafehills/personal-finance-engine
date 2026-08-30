"use client";

import { useState } from "react";
import { supabaseBrowser } from "../lib/supabase-browser";

type FactorSummary = {
  id: string;
  friendlyName: string;
  createdAt: string;
};

type Enrollment = {
  factorId: string;
  qrCode: string;
  secret: string;
};

export function MfaManager(
  { initialFactors }: { initialFactors: FactorSummary[] },
) {
  const [factors, setFactors] = useState(initialFactors);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("Authenticator app");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function beginEnrollment() {
    setBusy(true);
    setError(null);
    setMessage(null);
    const supabase = supabaseBrowser();
    const { data, error: enrollError } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: name.trim() || "Authenticator app",
      issuer: "OneLedger",
    });
    setBusy(false);

    if (enrollError || !data || data.type !== "totp") {
      setError(enrollError?.message ?? "Could not start authenticator setup.");
      return;
    }

    setEnrollment({
      factorId: data.id,
      qrCode: data.totp.qr_code,
      secret: data.totp.secret,
    });
  }

  async function verifyEnrollment() {
    if (!enrollment) return;
    setBusy(true);
    setError(null);
    const supabase = supabaseBrowser();
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
      factorId: enrollment.factorId,
      code: code.replace(/\s/g, ""),
    });

    if (verifyError) {
      setBusy(false);
      setError(
        "That code was not accepted. Check the time on your device and try again.",
      );
      return;
    }

    const { data } = await supabase.auth.mfa.listFactors();
    setFactors(
      (data?.totp ?? []).map((factor) => ({
        id: factor.id,
        friendlyName: factor.friendly_name ?? "Authenticator app",
        createdAt: factor.created_at,
      })),
    );
    setEnrollment(null);
    setCode("");
    setBusy(false);
    setMessage(
      "Authenticator verified. Sensitive actions now require a fresh MFA session.",
    );
  }

  async function cancelEnrollment() {
    if (!enrollment) return;
    setBusy(true);
    await supabaseBrowser().auth.mfa.unenroll({
      factorId: enrollment.factorId,
    });
    setEnrollment(null);
    setCode("");
    setBusy(false);
  }

  async function removeFactor(factorId: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    const { error: removeError } = await supabaseBrowser().auth.mfa.unenroll({
      factorId,
    });
    setBusy(false);
    if (removeError) {
      setError(
        "Verify with MFA in this session before removing a factor. You may also need to keep another factor for recovery.",
      );
      return;
    }
    setFactors((current) => current.filter((factor) => factor.id !== factorId));
    setMessage("Authenticator removed.");
  }

  return (
    <div className="flex flex-col gap-4 rounded-card border border-border-subtle bg-surface p-5">
      <div>
        <h2 className="text-sm font-medium text-text-primary">
          Two-step verification
        </h2>
        <p className="mt-1 text-sm text-text-muted">
          Use a TOTP authenticator such as 1Password, Google Authenticator, or
          Microsoft Authenticator. OneLedger never asks for your authenticator
          code outside sign-in and security confirmation screens.
        </p>
      </div>

      {factors.length > 0 && (
        <ul className="flex flex-col gap-2">
          {factors.map((factor) => (
            <li
              key={factor.id}
              className="flex items-center justify-between gap-3 rounded-control border border-border-subtle p-3"
            >
              <div>
                <p className="text-sm font-medium text-text-primary">
                  {factor.friendlyName}
                </p>
                <p className="text-xs text-text-muted">
                  Added {new Date(factor.createdAt).toLocaleDateString("en-US")}
                </p>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => removeFactor(factor.id)}
                className="min-h-11 rounded-control border border-border-strong px-3 text-sm text-attention disabled:opacity-50"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {!enrollment && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="flex flex-1 flex-col gap-1 text-sm text-text-secondary">
            Device name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={64}
              autoComplete="off"
              className="min-h-11 rounded-control border border-border-strong bg-background px-3 text-base text-text-primary"
            />
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={beginEnrollment}
            className="min-h-11 rounded-control bg-accent px-4 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? "Starting…" : "Add authenticator"}
          </button>
        </div>
      )}

      {enrollment && (
        <div className="flex flex-col gap-3 rounded-control border border-border-strong bg-background p-4">
          <p className="text-sm text-text-secondary">
            Scan this QR code, or enter the setup key manually. Then enter the
            six-digit code to finish enrollment.
          </p>
          {/* Supabase returns a local SVG data URL specifically for TOTP enrollment. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={enrollment.qrCode}
            alt="Authenticator enrollment QR code"
            width={192}
            height={192}
            className="rounded-control bg-white p-2"
          />
          <div>
            <p className="text-xs text-text-muted">Manual setup key</p>
            <code className="break-all text-sm text-text-primary">
              {enrollment.secret}
            </code>
          </div>
          <label className="flex max-w-xs flex-col gap-1 text-sm text-text-secondary">
            Verification code
            <input
              value={code}
              onChange={(event) => setCode(event.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={8}
              className="min-h-11 rounded-control border border-border-strong bg-surface px-3 text-base text-text-primary"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy || code.replace(/\s/g, "").length < 6}
              onClick={verifyEnrollment}
              className="min-h-11 rounded-control bg-accent px-4 text-sm font-medium text-white disabled:opacity-50"
            >
              Verify and enable
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={cancelEnrollment}
              className="min-h-11 rounded-control border border-border-strong px-4 text-sm text-text-secondary disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="rounded-control bg-background p-3 text-sm text-text-muted">
        <strong className="text-text-secondary">Recovery:</strong>{" "}
        Supabase TOTP does not provide recovery codes. Enroll a second
        authenticator before replacing your phone, and keep its setup securely
        backed up. If you lose every factor, account recovery requires verified
        support intervention.
      </div>

      {message && <p className="text-sm text-accent">{message}</p>}
      {error && (
        <p role="alert" className="text-sm text-attention">
          {error}
        </p>
      )}
    </div>
  );
}
