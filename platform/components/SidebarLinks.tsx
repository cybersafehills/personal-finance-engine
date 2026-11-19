"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ResolvedNavItem } from "../lib/console/nav";

export function SidebarLinks({
  groups,
}: {
  groups: { label: string; items: ResolvedNavItem[] }[];
}) {
  const pathname = usePathname();
  return (
    <nav aria-label="Console" className="px-2 pb-4">
      {groups.map((g) => (
        <div key={g.label} className="mt-3 first:mt-0">
          <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-text-3">
            {g.label}
          </p>
          <ul className="space-y-0.5">
            {g.items.map((i) => {
              if (i.state === "soon" || !i.href) {
                return (
                  <li key={i.label}>
                    <span
                      aria-disabled="true"
                      className="flex items-center justify-between rounded-control px-2 py-1.5 text-sm text-text-3"
                    >
                      {i.label}
                      <span className="rounded-full bg-surface-muted px-1.5 py-0.5 text-[10px]">Soon</span>
                    </span>
                  </li>
                );
              }
              const active = pathname === i.href || pathname.startsWith(`${i.href}/`);
              return (
                <li key={i.label}>
                  <Link
                    href={i.href}
                    aria-current={active ? "page" : undefined}
                    className={`block rounded-control px-2 py-1.5 text-sm ${
                      active
                        ? "bg-accent-soft font-medium text-accent"
                        : "text-text-2 hover:bg-surface-muted hover:text-text"
                    }`}
                  >
                    {i.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
