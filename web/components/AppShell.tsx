"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTransition } from "react";
import { signOut } from "../app/login/actions";
import { OneLedgerLogo } from "./brand/OneLedgerLogo";
import { DocumentIcon, GearIcon, HomeIcon, ListIcon, PieIcon, TargetIcon } from "./icons";
import { LiveDataSync } from "./LiveDataSync";
import { ProfileMenu } from "./ProfileMenu";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import type { WorkspaceSummary } from "../lib/queries";

const NAV_ITEMS = [
  { href: "/", label: "Home", Icon: HomeIcon },
  { href: "/transactions", label: "Transactions", Icon: ListIcon },
  { href: "/categories", label: "Categories", Icon: PieIcon },
  { href: "/budgets", label: "Budgets", Icon: TargetIcon },
  { href: "/reports", label: "Reports", Icon: DocumentIcon },
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
  workspaces,
  activeWorkspaceId,
}: {
  children: React.ReactNode;
  userEmail: string | null;
  workspaces: WorkspaceSummary[];
  activeWorkspaceId: string | null;
}) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-full flex-col">
      {userEmail && <LiveDataSync workspaceId={activeWorkspaceId} />}

      {/* Mobile top bar: logo on the left, a single profile-menu entry
          point in the standard top-right spot (see ProfileMenu's own
          comment for why account details live behind it instead of
          being spread across the header). Absent on auth pages. */}
      {userEmail && (
        <div className="flex items-center justify-between gap-3 border-b border-border-subtle bg-surface px-4 py-2.5 sm:hidden">
          <Link href="/" aria-label="OneLedger home">
            <OneLedgerLogo variant="mark" height={28} decorative />
          </Link>
          <ProfileMenu
            userEmail={userEmail}
            workspaces={workspaces}
            activeWorkspaceId={activeWorkspaceId}
          />
        </div>
      )}

      {/* Slim account bar - desktop/tablet only. On mobile this collapses
          into the ProfileMenu above instead of competing for header space
          with the logo. Absent on auth pages (no user yet) since there is
          nothing to sign out of. */}
      {userEmail && (
        <div className="hidden items-center justify-between gap-3 border-b border-border-subtle bg-surface px-4 py-1.5 text-xs sm:flex sm:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-text-muted">{userEmail}</span>
            {/* Only ever shown once there's an actual choice to make -
                see WorkspaceSwitcher's own comment. */}
            {workspaces.length > 1 && (
              <WorkspaceSwitcher
                workspaces={workspaces}
                activeWorkspaceId={activeWorkspaceId}
              />
            )}
          </div>
          <SignOutButton />
        </div>
      )}

      {/* Desktop / tablet: compact top header. Hidden on narrow phones in
          favor of the bottom bar, which is the primary mobile pattern for
          a 3-destination app. */}
      <header className="sticky top-0 z-10 hidden border-b border-border-subtle bg-surface/95 backdrop-blur sm:block">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-3">
          <Link href="/" aria-label="OneLedger home">
            <OneLedgerLogo height={32} decorative />
          </Link>
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
