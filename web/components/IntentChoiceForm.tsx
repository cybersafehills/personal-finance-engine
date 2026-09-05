"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setOnboardingIntent } from "../app/onboarding/actions";
import type { OnboardingIntent } from "../lib/onboarding-milestones";

const OPTIONS: {
  value: OnboardingIntent;
  label: string;
  blurb: string;
}[] = [
  {
    value: "personal",
    label: "Personal",
    blurb: "Just my own money - one ledger, my sources, my budgets.",
  },
  {
    value: "household",
    label: "Household",
    blurb:
      "Shared with family. Each person keeps their own sources and chooses what the household sees.",
  },
  {
    value: "business",
    label: "Business",
    blurb:
      "For a registered business - bills, approvals, reconciliation, and finance roles.",
  },
];

export function IntentChoiceForm({
  initial,
}: {
  initial: OnboardingIntent | null;
}) {
  const router = useRouter();
  const [choice, setChoice] = useState<OnboardingIntent | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    if (!choice) return;
    setError(null);
    startTransition(async () => {
      const result = await setOnboardingIntent(choice);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push("/get-started");
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">How will you use OneLedger?</legend>
        {OPTIONS.map((opt) => {
          const selected = choice === opt.value;
          return (
            <label
              key={opt.value}
              className={`flex cursor-pointer items-start gap-3 rounded-card border p-4 transition-colors ${
                selected
                  ? "border-accent bg-background"
                  : "border-border-subtle bg-surface hover:bg-background"
              }`}
            >
              <input
                type="radio"
                name="intent"
                value={opt.value}
                checked={selected}
                onChange={() => setChoice(opt.value)}
                className="mt-1"
              />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-text-primary">
                  {opt.label}
                </span>
                <span className="block text-sm text-text-muted">
                  {opt.blurb}
                </span>
              </span>
            </label>
          );
        })}
      </fieldset>

      {error && (
        <p role="alert" className="text-sm text-attention">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={!choice || pending}
          onClick={submit}
          className="min-h-11 rounded-control bg-accent px-4 text-sm font-semibold text-accent-foreground disabled:opacity-50"
        >
          {pending ? "Saving…" : "Continue"}
        </button>
        <p className="text-xs text-text-muted">
          You can change this later in settings.
        </p>
      </div>
    </div>
  );
}
