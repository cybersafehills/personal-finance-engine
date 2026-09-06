"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { OneLedgerLogo } from "../brand/OneLedgerLogo";

// The persistent top strip for every first-run screen: a real Back
// control (so the user is never trapped mid-step) and a way out to the
// app. No app nav here on purpose - setup is one focused task.
export function OnboardingTopBar({ exitHref = "/" }: { exitHref?: string }) {
  const router = useRouter();

  return (
    <div className="mx-auto flex w-full max-w-xl items-center justify-between gap-3 px-4 py-3 sm:px-0">
      <button
        type="button"
        onClick={() => router.back()}
        className="inline-flex min-h-9 items-center gap-1 rounded-control px-2 text-sm font-medium text-text-secondary hover:text-text-primary"
      >
        <span aria-hidden="true">←</span> Back
      </button>
      <OneLedgerLogo variant="mark" height={24} decorative />
      <Link
        href={exitHref}
        className="min-h-9 rounded-control px-2 text-sm font-medium leading-9 text-text-muted hover:text-text-primary"
      >
        Skip for now
      </Link>
    </div>
  );
}
