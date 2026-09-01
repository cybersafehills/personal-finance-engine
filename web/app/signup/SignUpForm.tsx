"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { MIN_PASSWORD_LENGTH } from "../../lib/registration";
import { signUp } from "./actions";

export function SignUpForm({ next }: { next: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

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
            router.push("/verify-email");
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
        <span className="relative">
          <input
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            minLength={MIN_PASSWORD_LENGTH}
            maxLength={256}
            aria-describedby="password-requirement"
            className="min-h-11 w-full rounded-control border border-border-strong bg-surface px-3 py-2 pr-16 text-sm text-text-primary"
          />
          <button
            type="button"
            onClick={() => setShowPassword((visible) => !visible)}
            className="absolute inset-y-0 right-0 px-3 text-xs font-medium text-accent"
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? "Hide" : "Show"}
          </button>
        </span>
        <span id="password-requirement" className="text-xs text-text-muted">
          At least {MIN_PASSWORD_LENGTH}{" "}
          characters. You can paste from a password manager.
        </span>
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
