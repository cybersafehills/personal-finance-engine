"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { resendVerificationEmail } from "../app/verify-email/actions";

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
    <div className="rounded-card border border-border-subtle bg-surface p-5 text-center">
      <h1 className="text-xl font-semibold text-text-primary">
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
        Click the link to verify your address and continue setting up your
        profile.
      </p>

      {callbackMessage && (
        <p
          role="alert"
          className="mt-4 rounded-control bg-attention/10 p-3 text-sm text-attention"
        >
          {callbackMessage}
        </p>
      )}
      {notice && (
        <p role="status" className="mt-4 text-sm text-accent">
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
              className="min-h-11 rounded-control bg-accent px-4 text-sm font-medium text-accent-foreground disabled:opacity-50"
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
              className="flex min-h-11 items-center justify-center rounded-control bg-accent px-4 text-sm font-medium text-accent-foreground"
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
