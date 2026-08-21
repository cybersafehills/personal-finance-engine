"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { updatePassword } from "../actions";

export default function ResetPasswordConfirmPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (done) {
    return (
      <div className="mx-auto max-w-sm py-10">
        <div className="rounded-card border border-border-subtle bg-surface p-5 text-center">
          <p className="text-sm font-medium text-text-primary">
            Password updated
          </p>
          <Link
            href="/"
            className="mt-3 inline-block min-h-11 rounded-control bg-accent px-4 py-2 text-sm font-medium text-accent-foreground"
          >
            Continue
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-sm flex-col gap-6 py-10">
      <div className="text-center">
        <h1 className="text-xl font-semibold text-text-primary">
          Choose a new password
        </h1>
      </div>
      <form
        className="flex flex-col gap-3 rounded-card border border-border-subtle bg-surface p-5"
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          startTransition(async () => {
            const result = await updatePassword(password);
            if (!result.ok) {
              setError(result.error);
              return;
            }
            setDone(true);
          });
        }}
      >
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-text-secondary">New password</span>
          <input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            minLength={8}
            className="min-h-11 rounded-control border border-border-strong bg-surface px-3 py-2 text-sm text-text-primary"
          />
        </label>
        <button
          type="submit"
          disabled={isPending}
          className="mt-2 min-h-11 rounded-control bg-accent px-4 text-sm font-medium text-accent-foreground disabled:opacity-50"
        >
          {isPending ? "Saving…" : "Save new password"}
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
