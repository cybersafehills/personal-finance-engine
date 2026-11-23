"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { activeHref, type ResolvedNavGroup } from "../lib/console/nav";
import { Icon } from "./ui/Icon";

export function SidebarLinks({
  groups,
  onNavigate,
}: {
  groups: ResolvedNavGroup[];
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const current = activeHref(pathname, groups);
  return (
    <nav aria-label="Console" className="px-3 pb-6">
      {groups.map((g) => (
        <div key={g.label} className="mt-5 first:mt-1">
          <p className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-side-muted">{g.label}</p>
          <ul className="space-y-0.5">
            {g.items.map((i) => {
              if (i.state === "soon" || !i.href) {
                return (
                  <li key={i.label}>
                    <span aria-disabled="true" className="flex items-center gap-2.5 rounded-control px-2 py-1.5 text-[13px] text-side-muted/80">
                      <Icon name={i.icon} className="shrink-0 opacity-60" />
                      <span className="flex-1">{i.label}</span>
                      <span className="rounded-full border border-side-border px-1.5 py-px text-[10px] font-medium text-side-muted">Soon</span>
                    </span>
                  </li>
                );
              }
              const active = i.href === current;
              return (
                <li key={i.label}>
                  <Link
                    href={i.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={`relative flex items-center gap-2.5 rounded-control px-2 py-1.5 text-[13px] transition-colors ${
                      active ? "bg-side-active font-medium text-side-strong" : "text-side-text hover:bg-side-bg-2 hover:text-side-strong"
                    }`}
                  >
                    {active ? <span aria-hidden className="absolute left-0 top-1.5 h-[calc(100%-0.75rem)] w-[3px] rounded-full bg-side-bar" /> : null}
                    <Icon name={i.icon} className="shrink-0" />
                    <span className="truncate">{i.label}</span>
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
