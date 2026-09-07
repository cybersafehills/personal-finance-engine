"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// While a statement is still being assembled by the statement-jobs worker
// (status 'preparing' / 'generating'), poll the detail page so it flips to
// the ready view on its own. Stops as soon as `active` is false.
export function StatementAutoRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(id);
  }, [active, router]);
  return null;
}
