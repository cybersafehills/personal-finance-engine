"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

// Status filter chips for the Bills landing page (Phase 7). Updates the
// `status` search param; the server component re-queries.

const GROUPS: { key: string; label: string }[] = [
  { key: "all", label: "All" },
  { key: "needs_review", label: "Needs review" },
  { key: "approved", label: "Approved" },
  { key: "posted", label: "Posted" },
  { key: "matched", label: "Matched" },
  { key: "processing_failed", label: "Failed" },
  { key: "archived", label: "Archived" },
];

export function BillListFilters({ active }: { active: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function set(key: string) {
    const next = new URLSearchParams(params);
    if (key === "all") next.delete("status");
    else next.set("status", key);
    router.push(`${pathname}?${next.toString()}`);
  }

  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by status">
      {GROUPS.map((g) => {
        const on = g.key === active || (g.key === "all" && !active);
        return (
          <button
            key={g.key}
            type="button"
            aria-pressed={on}
            onClick={() => set(g.key)}
            className={`min-h-9 rounded-full px-3 text-sm font-medium ${
              on
                ? "bg-accent text-accent-foreground"
                : "border border-border-strong text-text-secondary hover:text-text-primary"
            }`}
          >
            {g.label}
          </button>
        );
      })}
    </div>
  );
}
