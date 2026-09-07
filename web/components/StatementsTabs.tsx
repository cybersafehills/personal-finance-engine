"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// The "Reports / Statements" strip that sits above both /reports and
// /reports/statements. Statements nest under Reports in the IA, but the
// two are conceptually distinct (Reports analyse, Statements record) - the
// tab labels keep that visible.
const TABS = [
  { href: "/reports", label: "Reports" },
  { href: "/reports/statements", label: "Statements" },
] as const;

export function StatementsTabs() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Reports sections"
      className="mb-4 flex gap-1 border-b border-border-subtle"
    >
      {TABS.map((tab) => {
        const active = tab.href === "/reports"
          ? pathname === "/reports"
          : pathname.startsWith("/reports/statements");
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={`-mb-px min-h-11 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              active
                ? "border-accent text-text-primary"
                : "border-transparent text-text-muted hover:text-text-secondary"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
