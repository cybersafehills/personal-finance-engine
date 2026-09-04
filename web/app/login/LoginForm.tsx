"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { EyeIcon, EyeOffIcon, LockIcon, MailIcon } from "../../components/auth/AuthIcon";
import { signIn } from "./actions";

export function LoginForm({ next }: { next: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <form
      className="flex flex-col gap-4 rounded-card border border-border-subtle bg-surface p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_-16px_rgba(7,20,58,0.18)]"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        startTransition(async () => {
          const result = await signIn(email, password, next);
          if (!result.ok) setError(result.error);
        });
      }}
    >
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-text-secondary">Email</span>
        <span className="relative flex items-center">
          <MailIcon className="pointer-events-none absolute left-3 h-4 w-4 text-text-muted" />
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            className="min-h-11 w-full rounded-control border border-border-strong bg-surface py-2 pl-9 pr-3 text-sm text-text-primary transition-colors focus:border-accent"
            placeholder="you@example.com"
          />
        </span>
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-text-secondary">Password</span>
        <span className="relative flex items-center">
          <LockIcon className="pointer-events-none absolute left-3 h-4 w-4 text-text-muted" />
          <input
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            className="min-h-11 w-full rounded-control border border-border-strong bg-surface py-2 pl-9 pr-10 text-sm text-text-primary transition-colors focus:border-accent"
          />
          <button
            type="button"
            onClick={() => setShowPassword((visible) => !visible)}
            className="absolute right-0 flex h-11 w-10 items-center justify-center text-text-muted hover:text-text-primary"
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? <EyeOffIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
          </button>
        </span>
      </label>

      <button
        type="submit"
        disabled={isPending}
        className="mt-1 flex min-h-11 items-center justify-center gap-2 rounded-control bg-accent px-4 text-sm font-semibold text-accent-foreground shadow-sm transition-[opacity,transform] hover:opacity-95 active:scale-[0.99] disabled:opacity-50 disabled:active:scale-100"
      >
        {isPending && (
          <span
            aria-hidden
            className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-accent-foreground/40 border-t-accent-foreground"
          />
        )}
        {isPending ? "Signing in…" : "Sign in"}
      </button>

      <Link
        href="/auth/reset-password"
        className="text-center text-sm font-medium text-accent hover:underline"
      >
        Forgot your password?
      </Link>

      {error && (
        <p role="alert" className="rounded-control bg-attention-bg px-3 py-2 text-sm text-attention">
          {error}
        </p>
      )}
    </form>
  );
}
