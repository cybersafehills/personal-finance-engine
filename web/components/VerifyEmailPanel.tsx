"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import {
  resendVerificationEmail,
  verifySignupCode,
} from "../app/verify-email/actions";
import { AlertIcon, MailIcon } from "./auth/AuthIcon";

type VerificationStatus = "expired" | "invalid" | "missing" | null;

function statusMessage(status: VerificationStatus): string | null {
  if (status === "expired") {
    return "That verification link has expired. Request a fresh link below.";
  }
  if (status === "invalid") {
    return "That link is no longer available. It may already have been used. Try signing in or request a fresh link.";
  }
  if (status === "missing") {
    return "The verification link is incomplete. Request a fresh link below.";
  }
  return null;
}

export function VerifyEmailPanel({
  email,
  initialNow,
  initialResendAvailableAt,
  status,
}: {
  email: string | null;
  initialNow: number;
  initialResendAvailableAt: number;
  status: VerificationStatus;
}) {
  const [resendAvailableAt, setResendAvailableAt] = useState(
    initialResendAvailableAt,
  );
  const [now, setNow] = useState(initialNow);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [isVerifying, startVerify] = useTransition();

  useEffect(() => {
    if (resendAvailableAt <= Date.now()) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [resendAvailableAt]);

  const secondsRemaining = Math.max(
    0,
    Math.ceil((resendAvailableAt - now) / 1000),
  );
  const callbackMessage = statusMessage(status);

  return (
    <div className="rounded-card border border-border-subtle bg-surface p-6 text-center shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_-16px_rgba(7,20,58,0.18)]">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent/10 text-accent">
        <MailIcon className="h-6 w-6" />
      </div>
      <h1 className="mt-4 text-xl font-semibold tracking-tight text-text-primary">
        Check your email
      </h1>
      <p className="mt-2 text-sm text-text-muted">
        {email
          ? (
            <>
              We sent a verification link to{" "}
              <strong className="font-medium text-text-primary">{email}
              </strong>.
            </>
          )
          : (
            "Open the verification email from OneLedger to continue."
          )}
      </p>
      <p className="mt-2 text-sm text-text-muted">
        Enter the 6-digit code from that email below, or just tap the link in
        it - either one verifies your address.
      </p>

      {email && (
        <form
          className="mt-5 flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            setCodeError(null);
            startVerify(async () => {
              const result = await verifySignupCode(code);
              // Success redirects server-side; we only get here on failure.
              setCodeError(result.error);
            });
          }}
        >
          <label
            htmlFor="verify-code"
            className="text-left text-sm font-medium text-text-secondary"
          >
            Verification code
          </label>
          <input
            id="verify-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={6}
            value={code}
            onChange={(event) =>
              setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="123456"
            className="min-h-11 rounded-control border border-border-strong bg-surface px-3 text-center text-lg tracking-[0.4em] text-text-primary focus:border-accent"
          />
          <button
            type="submit"
            disabled={isVerifying || code.length < 6}
            className="min-h-11 rounded-control bg-accent px-4 text-sm font-semibold text-accent-foreground shadow-sm transition-opacity hover:opacity-95 disabled:opacity-50"
          >
            {isVerifying ? "Verifying…" : "Verify and continue"}
          </button>
          {codeError && (
            <p role="alert" className="text-left text-sm text-attention">
              {codeError}
            </p>
          )}
        </form>
      )}

      {callbackMessage && (
        <p
          role="alert"
          className="mt-4 flex items-start gap-2 rounded-control bg-attention-bg p-3 text-left text-sm text-attention"
        >
          <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{callbackMessage}</span>
        </p>
      )}
      {notice && (
        <p role="status" className="mt-4 text-sm font-medium text-accent">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-4 text-sm text-attention">
          {error}
        </p>
      )}

      <div className="mt-5 flex flex-col gap-3">
        {email
          ? (
            <button
              type="button"
              disabled={isPending || secondsRemaining > 0}
              onClick={() => {
                setNotice(null);
                setError(null);
                startTransition(async () => {
                  const result = await resendVerificationEmail();
                  if (!result.ok) {
                    setError(result.error);
                    if (result.resendAvailableAt) {
                      setResendAvailableAt(result.resendAvailableAt);
                      setNow(Date.now());
                    }
                    return;
                  }
                  setResendAvailableAt(result.resendAvailableAt);
                  setNow(Date.now());
                  setNotice("A fresh verification link is on its way.");
                });
              }}
              className="min-h-11 rounded-control bg-accent px-4 text-sm font-semibold text-accent-foreground shadow-sm transition-opacity hover:opacity-95 disabled:opacity-50"
            >
              {isPending
                ? "Sending…"
                : secondsRemaining > 0
                ? `Resend available in ${secondsRemaining}s`
                : "Resend verification email"}
            </button>
          )
          : (
            <Link
              href="/signup"
              className="flex min-h-11 items-center justify-center rounded-control bg-accent px-4 text-sm font-semibold text-accent-foreground shadow-sm transition-opacity hover:opacity-95"
            >
              Return to sign up
            </Link>
          )}

        <Link
          href="/signup"
          className="text-sm font-medium text-accent hover:underline"
        >
          Change email address
        </Link>
        <Link
          href="/login"
          className="text-sm text-text-muted hover:text-text-primary"
        >
          Already verified? Sign in
        </Link>
      </div>
    </div>
  );
}
