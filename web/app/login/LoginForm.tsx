"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { signIn } from "./actions";

export function LoginForm({ next }: { next: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <form
      className="flex flex-col gap-3 rounded-card border border-border-subtle bg-surface p-5"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        startTransition(async () => {
          const result = await signIn(email, password, next);
          if (!result.ok) setError(result.error);
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
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
          className="min-h-11 rounded-control border border-border-strong bg-surface px-3 py-2 text-sm text-text-primary"
        />
      </label>

      <button
        type="submit"
        disabled={isPending}
        className="mt-2 min-h-11 rounded-control bg-accent px-4 text-sm font-medium text-accent-foreground disabled:opacity-50"
      >
        {isPending ? "Signing in…" : "Sign in"}
      </button>

      <Link
        href="/auth/reset-password"
        className="text-center text-sm text-text-muted hover:text-text-primary"
      >
        Forgot your password?
      </Link>

      {error && (
        <p role="alert" className="text-sm text-attention">
          {error}
        </p>
      )}
    </form>
  );
}
