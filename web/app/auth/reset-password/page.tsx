"use client";

import { useState, useTransition } from "react";
import { requestPasswordReset } from "./actions";

export default function ResetPasswordRequestPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (sent) {
    return (
      <div className="mx-auto max-w-sm py-10">
        <div className="rounded-card border border-border-subtle bg-surface p-5 text-center">
          <p className="text-sm font-medium text-text-primary">Check your email</p>
          <p className="mt-1 text-sm text-text-muted">
            If an account exists for {email}, a password reset link has been sent.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-sm flex-col gap-6 py-10">
      <div className="text-center">
        <h1 className="text-xl font-semibold text-text-primary">Reset password</h1>
        <p className="mt-1 text-sm text-text-muted">
          We&apos;ll email you a link to choose a new one.
        </p>
      </div>
      <form
        className="flex flex-col gap-3 rounded-card border border-border-subtle bg-surface p-5"
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          startTransition(async () => {
            const result = await requestPasswordReset(email);
            if (!result.ok) {
              setError(result.error);
              return;
            }
            setSent(true);
          });
        }}
      >
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-text-secondary">Email</span>
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            className="min-h-11 rounded-control border border-border-strong bg-surface px-3 py-2 text-sm text-text-primary"
          />
        </label>
        <button
          type="submit"
          disabled={isPending}
          className="mt-2 min-h-11 rounded-control bg-accent px-4 text-sm font-medium text-accent-foreground disabled:opacity-50"
        >
          {isPending ? "Sending…" : "Send reset link"}
        </button>
        {error && (
          <p role="alert" className="text-sm text-attention">
            {error}
          </p>
        )}
      </form>
    </div>
  );
}
