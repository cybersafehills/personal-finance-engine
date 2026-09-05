"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { EyeIcon, EyeOffIcon, LockIcon, MailIcon } from "../../components/auth/AuthIcon";
import {
  MIN_PASSWORD_LENGTH,
  PASSWORD_REQUIREMENT_HINT,
} from "../../lib/registration";
import { signUp } from "./actions";

function passwordStrength(password: string): { label: string; level: 0 | 1 | 2 | 3 } {
  if (!password) return { label: "", level: 0 };
  let score = 0;
  if (password.length >= MIN_PASSWORD_LENGTH) score++;
  if (password.length >= 12) score++;
  if (/[0-9]/.test(password) && /[A-Za-z]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  if (score <= 1) return { label: "Weak", level: 1 };
  if (score <= 2) return { label: "Okay", level: 2 };
  return { label: "Strong", level: 3 };
}

export function SignUpForm({ next }: { next: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const strength = useMemo(() => passwordStrength(password), [password]);

  return (
    <form
      className="flex flex-col gap-4 rounded-card border border-border-subtle bg-surface p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_-16px_rgba(7,20,58,0.18)]"
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

      <div className="flex flex-col gap-1.5 text-sm">
        <label htmlFor="signup-password" className="font-medium text-text-secondary">
          Password
        </label>
        <span className="relative flex items-center">
          <LockIcon className="pointer-events-none absolute left-3 h-4 w-4 text-text-muted" />
          <input
            id="signup-password"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            minLength={MIN_PASSWORD_LENGTH}
            maxLength={256}
            aria-describedby="password-requirement"
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

        {password
          ? (
            <div className="flex items-center gap-2" aria-hidden>
              <div className="flex h-1 flex-1 gap-1">
                {[1, 2, 3].map((step) => (
                  <span
                    key={step}
                    className={`h-full flex-1 rounded-full transition-colors ${
                      step <= strength.level
                        ? strength.level === 1
                          ? "bg-attention"
                          : strength.level === 2
                          ? "bg-accent"
                          : "bg-money-positive"
                        : "bg-border-subtle"
                    }`}
                  />
                ))}
              </div>
              <span className="text-xs font-medium text-text-muted">{strength.label}</span>
            </div>
          )
          : null}

        <span id="password-requirement" className="text-xs text-text-muted">
          {PASSWORD_REQUIREMENT_HINT} You can paste from a password manager.
        </span>
      </div>

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
        {isPending ? "Creating account…" : "Create account"}
      </button>

      {error && (
        <p role="alert" className="rounded-control bg-attention-bg px-3 py-2 text-sm text-attention">
          {error}
        </p>
      )}

      <p className="text-center text-xs text-text-muted">
        By creating an account you agree to keep your data yours - OneLedger
        never sells it.
      </p>
    </form>
  );
}
