"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { breadcrumbFor, type ResolvedNavGroup } from "../lib/console/nav";
import { CommandPalette } from "./CommandPalette";
import { SidebarLinks } from "./SidebarLinks";
import { ThemeToggle } from "./ThemeToggle";
import { Icon } from "./ui/Icon";

export function ShellFrame({
  groups,
  roleLabel,
  email,
  env,
  theme,
  canSearchCustomers,
  signOutSlot,
  children,
}: {
  groups: ResolvedNavGroup[];
  roleLabel: string;
  email: string | null;
  env: { label: string; tone: string };
  theme: "light" | "dark" | null;
  canSearchCustomers: boolean;
  signOutSlot: React.ReactNode;
  children: React.ReactNode;
}) {
  // The drawer is "open at" a path, so navigating anywhere closes it without an effect.
  const [openAt, setOpenAt] = useState<string | null>(null);
  const pathname = usePathname();
  const crumb = breadcrumbFor(pathname, groups);

  const drawer = openAt === pathname;
  const setDrawer = (v: boolean) => setOpenAt(v ? pathname : null);

  const brand = (
    <div className="flex items-center gap-2.5 px-4 py-4">
      <Image src="/brand/mark.png" alt="" width={28} height={28} className="rounded-md bg-white p-0.5" />
      <div className="leading-tight">
        <Link href="/dashboard" className="text-sm font-semibold text-side-strong">OneLedger</Link>
        <p className="text-[11px] text-side-muted">Platform Console</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[16rem_minmax(0,1fr)]">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-control focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside className="hidden border-r border-side-border bg-side-bg lg:sticky lg:top-0 lg:block lg:h-screen lg:overflow-y-auto">
        {brand}
        <SidebarLinks groups={groups} />
      </aside>

      {/* Mobile drawer */}
      {drawer ? (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button aria-label="Close navigation" className="absolute inset-0 bg-black/50" onClick={() => setDrawer(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] overflow-y-auto bg-side-bg shadow-pop">
            <div className="flex items-center justify-between pr-3">
              {brand}
              <button aria-label="Close" onClick={() => setDrawer(false)} className="rounded-control p-1.5 text-side-text hover:bg-side-bg-2">
                <Icon name="close" />
              </button>
            </div>
            <SidebarLinks groups={groups} onNavigate={() => setDrawer(false)} />
          </aside>
        </div>
      ) : null}

      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-surface/95 px-3 backdrop-blur sm:px-5">
          <button
            type="button"
            aria-label="Open navigation"
            onClick={() => setDrawer(true)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-control border border-border text-text-2 lg:hidden"
          >
            <Icon name="menu" />
          </button>
          <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-1.5 text-sm md:flex">
            {crumb ? (
              <>
                <span className="text-text-3">{crumb.group}</span>
                <Icon name="next" size={14} className="text-text-3" />
                <span className="truncate font-medium">{crumb.label}</span>
              </>
            ) : null}
          </nav>
          <div className="flex flex-1 justify-center">
            <CommandPalette groups={groups} canSearchCustomers={canSearchCustomers} />
          </div>
          <span className={`hidden rounded-full px-2 py-0.5 text-[11px] font-medium sm:inline ${env.tone}`}>{env.label}</span>
          <ThemeToggle initial={theme} />
          <div className="hidden text-right leading-tight sm:block">
            <p className="text-xs font-medium">{roleLabel}</p>
            <p className="max-w-[12rem] truncate text-[11px] text-text-3">{email ?? "—"}</p>
          </div>
          {signOutSlot}
        </header>
        <main id="main" className="mx-auto w-full max-w-[96rem] px-3 py-5 sm:px-6 sm:py-6">
          {children}
        </main>
      </div>
    </div>
  );
}
