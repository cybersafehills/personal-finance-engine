"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { signUp } from "./actions";

export function SignUpForm({ next }: { next: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmationSent, setConfirmationSent] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (confirmationSent) {
    return (
      <div className="rounded-card border border-border-subtle bg-surface p-5 text-center">
        <p className="text-sm font-medium text-text-primary">
          Check your email
        </p>
        <p className="mt-1 text-sm text-text-muted">
          We sent a confirmation link to {email}. Sign in once you&apos;ve
          confirmed your address.
        </p>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-3 rounded-card border border-border-subtle bg-surface p-5"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        startTransition(async () => {
          const result = await signUp(email, password, next);
          if (!result.ok) {
            setError(result.error);
            return;
          }
          if (result.needsConfirmation) {
            setConfirmationSent(true);
          } else {
            router.push(next || "/");
          }
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

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-text-secondary">Password</span>
        <input
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
          minLength={8}
          className="min-h-11 rounded-control border border-border-strong bg-surface px-3 py-2 text-sm text-text-primary"
        />
        <span className="text-xs text-text-muted">At least 8 characters.</span>
      </label>

      <button
        type="submit"
        disabled={isPending}
        className="mt-2 min-h-11 rounded-control bg-accent px-4 text-sm font-medium text-accent-foreground disabled:opacity-50"
      >
        {isPending ? "Creating account…" : "Create account"}
      </button>

      {error && (
        <p role="alert" className="text-sm text-attention">
          {error}
        </p>
      )}
    </form>
  );
}
