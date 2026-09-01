"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { completeProfileOnboarding } from "../app/onboarding/actions";

export function OnboardingChoiceLink({ href, children }: { href: string; children: ReactNode }) {
  const router = useRouter();
  const [error, setError] = useState(false);
  const [isPending, startTransition] = useTransition();

  return <div>
    <button
      type="button"
      disabled={isPending}
      onClick={() => startTransition(async () => {
        setError(false);
        const result = await completeProfileOnboarding();
        if (result.ok) router.push(href);
        else setError(true);
      })}
      className="h-full w-full rounded-control border border-border-subtle p-3 text-left transition-colors hover:bg-background focus-visible:bg-background disabled:opacity-50"
    >
      {children}
    </button>
    {error && <p role="alert" className="mt-1 text-xs text-attention">Could not finish setup. Try again.</p>}
  </div>;
}
