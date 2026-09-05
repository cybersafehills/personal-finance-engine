"use client";

import Link from "next/link";
import { useTransition } from "react";
import { confirmSignupEmail } from "../app/auth/confirm/actions";
import { AlertIcon, ShieldCheckIcon } from "./auth/AuthIcon";

export function ConfirmEmailPanel({
  tokenHash,
}: {
  tokenHash: string | null;
}) {
  const [isPending, startTransition] = useTransition();

  if (!tokenHash) {
    return (
      <div className="rounded-card border border-border-subtle bg-surface p-6 text-center shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_-16px_rgba(7,20,58,0.18)]">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-attention-bg text-attention">
          <AlertIcon className="h-6 w-6" />
        </div>
        <h1 className="mt-4 text-xl font-semibold tracking-tight text-text-primary">
          This link is incomplete
        </h1>
        <p className="mt-2 text-sm text-text-muted">
          Part of the confirmation link is missing, so we can&apos;t verify your
          address from it. Request a fresh one below.
        </p>
        <Link
          href="/verify-email"
          className="mt-5 flex min-h-11 items-center justify-center rounded-control bg-accent px-4 text-sm font-semibold text-accent-foreground shadow-sm transition-opacity hover:opacity-95"
        >
          Back to verification
        </Link>
      </div>
    );
  }

  return (
    <div className="rounded-card border border-border-subtle bg-surface p-6 text-center shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_-16px_rgba(7,20,58,0.18)]">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent/10 text-accent">
        <ShieldCheckIcon className="h-6 w-6" />
      </div>
      <h1 className="mt-4 text-xl font-semibold tracking-tight text-text-primary">
        Confirm your email
      </h1>
      <p className="mt-2 text-sm text-text-muted">
        Tap the button below to finish verifying your address. Requiring a
        tap - rather than verifying the instant this page loads - keeps
        automated link scanners in your email provider from using up the
        link before you ever see it.
      </p>
      <button
        type="button"
        disabled={isPending}
        onClick={() => startTransition(() => confirmSignupEmail(tokenHash))}
        className="mt-5 flex min-h-11 w-full items-center justify-center gap-2 rounded-control bg-accent px-4 text-sm font-semibold text-accent-foreground shadow-sm transition-[opacity,transform] hover:opacity-95 active:scale-[0.99] disabled:opacity-50 disabled:active:scale-100"
      >
        {isPending && (
          <span
            aria-hidden
            className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-accent-foreground/40 border-t-accent-foreground"
          />
        )}
        {isPending ? "Confirming…" : "Confirm my email"}
      </button>
    </div>
  );
}
