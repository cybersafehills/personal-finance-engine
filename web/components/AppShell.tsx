"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTransition } from "react";
import { signOut } from "../app/login/actions";
import { GearIcon, HomeIcon, ListIcon, PieIcon } from "./icons";

const NAV_ITEMS = [
  { href: "/", label: "Home", Icon: HomeIcon },
  { href: "/transactions", label: "Transactions", Icon: ListIcon },
  { href: "/categories", label: "Categories", Icon: PieIcon },
  { href: "/settings", label: "Settings", Icon: GearIcon },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function SignOutButton() {
  const [isPending, startTransition] = useTransition();
  return (
    <button
      type="button"
      onClick={() => startTransition(() => signOut())}
      disabled={isPending}
      className="rounded-full px-3 py-1 text-xs font-medium text-text-muted transition-colors hover:bg-background hover:text-text-primary disabled:opacity-50"
    >
      {isPending ? "Signing out…" : "Sign out"}
    </button>
  );
}

export function AppShell({
  children,
  userEmail,
}: {
  children: React.ReactNode;
  userEmail: string | null;
}) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-full flex-col">
      {/* Slim account bar - visible on every screen size, independent of
          the desktop nav pills below it. Absent on auth pages (no user
          yet) since there is nothing to sign out of. */}
      {userEmail && (
        <div className="flex items-center justify-between border-b border-border-subtle bg-surface px-4 py-1.5 text-xs sm:px-6">
          <span className="truncate text-text-muted">{userEmail}</span>
          <SignOutButton />
        </div>
      )}

      {/* Desktop / tablet: compact top header. Hidden on narrow phones in
          favor of the bottom bar, which is the primary mobile pattern for
          a 3-destination app. */}
      <header className="sticky top-0 z-10 hidden border-b border-border-subtle bg-surface/95 backdrop-blur sm:block">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-3">
          <span className="text-sm font-semibold tracking-tight text-text-primary">
            Personal Finance
          </span>
          <nav className="flex items-center gap-1" aria-label="Primary">
            {NAV_ITEMS.map(({ href, label }) => {
              const active = isActive(pathname, href);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                    active
                      ? "bg-accent text-accent-foreground"
                      : "text-text-secondary hover:bg-background hover:text-text-primary"
                  }`}
                >
                  {label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-24 pt-5 sm:px-6 sm:pb-10 sm:pt-6">
        {children}
      </main>

      {/* Mobile: persistent bottom navigation with icon + label, honoring
          the iPhone home-indicator safe area. */}
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-10 border-t border-border-subtle bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden"
      >
        <div className="mx-auto flex max-w-3xl items-stretch justify-around">
          {NAV_ITEMS.map(({ href, label, Icon }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className="flex min-w-16 flex-1 flex-col items-center gap-0.5 px-2 py-2.5 text-[11px] font-medium"
              >
                <Icon
                  className={`h-6 w-6 ${active ? "text-accent" : "text-text-muted"}`}
                />
                <span className={active ? "text-accent" : "text-text-muted"}>
                  {label}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
