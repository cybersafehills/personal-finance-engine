"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

// Route-level boundary for one payment. A render failure here (typically a
// transient fetch error racing a live refresh) must never look like the
// payment failed - the money state lives in the database, not in this page.
// It quietly retries a couple of times before showing a calm fallback.
export default function PaymentIntentError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();
  const attempts = useRef(0);

  useEffect(() => {
    console.error("Payment page render failed:", error);
    if (attempts.current >= 2) return;
    attempts.current += 1;
    const t = setTimeout(() => {
      router.refresh();
      reset();
    }, 800 * attempts.current);
    return () => clearTimeout(t);
  }, [error, reset, router]);

  return (
    <div role="status" className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <p className="text-base font-medium text-text-primary">Updating your payment status…</p>
      <p className="text-sm text-text-muted">
        This page hit a snag loading. It does not mean your payment failed - check Payment activity
        for the latest status.
      </p>
      <div className="mt-2 flex gap-3">
        <button
          type="button"
          onClick={() => reset()}
          className="min-h-11 rounded-control bg-accent px-4 text-sm font-medium text-accent-foreground"
        >
          Reload
        </button>
        <Link
          href="/pay/activity"
          className="inline-flex min-h-11 items-center rounded-control border border-border-subtle px-4 text-sm text-text-primary"
        >
          Payment activity
        </Link>
      </div>
    </div>
  );
}
