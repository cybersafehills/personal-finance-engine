"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { OneLedgerLogo } from "./brand/OneLedgerLogo";
import { GearIcon, HomeIcon, ListIcon, MoreIcon, PieIcon, TargetIcon } from "./icons";
import { LiveDataSync } from "./LiveDataSync";
import { MoreSheet } from "./MoreSheet";
import { NotificationBell } from "./NotificationBell";
import { ProfileMenu } from "./ProfileMenu";
import { PrivacyProvider } from "./PrivacyProvider";
import { PayProvider } from "./pay/PayProvider";
import { PayTrigger } from "./pay/PayTrigger";
import { ReportsButton } from "./ReportsButton";
import { ReportsRelocationNotice } from "./ReportsRelocationNotice";
import {
  MORE_MENU_PREFIXES,
  NAV_ITEM_META,
  type NavKey,
} from "../lib/navigation";
import type { WorkspaceSummary } from "../lib/queries";

const NAV_ICONS: Record<NavKey, (props: { className?: string }) => React.JSX.Element> = {
  transactions: ListIcon,
  categories: PieIcon,
  budgets: TargetIcon,
  settings: GearIcon,
};

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * The five primary destinations in the caller's chosen order: Home is
 * always first and never movable (master prompt §5), the remaining four
 * follow navOrder (already validated/normalized server-side by
 * getUiPreferences - see lib/navigation.ts). Reports is never a member of
 * this list; it lives only behind ReportsButton and the Settings link.
 */
function useOrderedNavItems(navOrder: NavKey[]) {
  return [
    { href: "/", label: "Home", Icon: HomeIcon },
    ...navOrder.map((key) => ({
      href: NAV_ITEM_META[key].href,
      label: NAV_ITEM_META[key].label,
      Icon: NAV_ICONS[key],
    })),
  ];
}

/** One icon+label item in the phone bottom bar. */
function BottomNavLink({
  href,
  label,
  Icon,
  pathname,
}: {
  href: string;
  label: string;
  Icon: (props: { className?: string }) => React.JSX.Element;
  pathname: string;
}) {
  const active = isActive(pathname, href);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className="flex min-w-16 flex-1 flex-col items-center gap-0.5 px-2 py-2.5 text-[11px] font-medium"
    >
      <Icon className={`h-6 w-6 ${active ? "text-accent" : "text-text-muted"}`} />
      <span className={active ? "text-accent" : "text-text-muted"}>{label}</span>
    </Link>
  );
}

export function AppShell({
  children,
  userEmail,
  workspaces,
  activeWorkspaceId,
  navOrder,
  hideBalance,
  privacyMode,
  reportsRelocationNoticeDismissed,
  payEnabled,
  assistedPayEnabled,
  scanToPayEnabled,
  unreadNotificationCount,
}: {
  children: React.ReactNode;
  userEmail: string | null;
  workspaces: WorkspaceSummary[];
  activeWorkspaceId: string | null;
  navOrder: NavKey[];
  hideBalance: boolean;
  privacyMode: boolean;
  reportsRelocationNoticeDismissed: boolean;
  payEnabled: boolean;
  assistedPayEnabled: boolean;
  scanToPayEnabled: boolean;
  unreadNotificationCount: number;
}) {
  const pathname = usePathname();
  const navItems = useOrderedNavItems(navOrder);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreActive = MORE_MENU_PREFIXES.some((p) => isActive(pathname, p));

  const shell = (
    <div className="flex min-h-full flex-col">
      {userEmail && <LiveDataSync workspaceId={activeWorkspaceId} />}

      {/* Unified authenticated header - one definition for every device
          size, so mobile and desktop can never drift into two competing
          navigation/account implementations. Brand left; Reports icon
          and the profile menu (email, workspace switcher, settings
          shortcuts, sign-out) on the right. Absent entirely on
          unauthenticated pages (no user yet). */}
      {userEmail && (
        <header className="sticky top-0 z-10 border-b border-border-subtle bg-surface/95 backdrop-blur">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-2.5 sm:px-6 lg:max-w-5xl lg:px-8">
            <Link href="/" aria-label="OneLedger home" className="shrink-0">
              <OneLedgerLogo variant="mark" height={28} decorative className="lg:hidden" />
              <OneLedgerLogo height={32} decorative className="hidden lg:block" />
            </Link>

            {/* Desktop/tablet primary nav lives inline in the header, to
                the left of the account controls, rather than as a second
                stacked bar - compact icon+label pills, ordered per the
                caller's saved preference. Kicks in at lg: (1024px), not
                sm: (640px) - 5 full-text-label pills plus the logo and
                header icons don't fit in the 640-1023px range (a real
                overflow bug caught by e2e/responsive-matrix.spec.ts's
                tablet-portrait/768px case), and lg: is already where the
                dashboard's own two-column grid switches, so the two
                breakpoints stay in sync. */}
            <nav
              aria-label="Primary"
              className="hidden flex-1 items-center justify-center gap-1 lg:flex"
            >
              {navItems.map(({ href, label }) => {
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

            <div className="flex shrink-0 items-center gap-1.5">
              {payEnabled && <PayTrigger variant="desktop" />}
              <NotificationBell count={unreadNotificationCount} />
              <ReportsButton />
              <ProfileMenu
                userEmail={userEmail}
                workspaces={workspaces}
                activeWorkspaceId={activeWorkspaceId}
              />
            </div>
          </div>
        </header>
      )}

      {userEmail && !reportsRelocationNoticeDismissed && <ReportsRelocationNotice />}

      {/* Wider (not full-bleed) on large screens - see master prompt §10:
          "constrained but appropriately wider content container" -
          giving Home's desktop two-column grid (app/page.tsx) room to
          breathe without stretching every other page's simple stacked
          lists to an uncomfortable width. */}
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-24 pt-5 sm:px-6 sm:pb-10 sm:pt-6 lg:max-w-5xl lg:px-8">
        {children}
      </main>

      {/* Phone/tablet: a FIXED five-slot bottom bar - Home, Transactions,
          the elevated Pay action dead-centre, Budgets, and More - matching
          the master prompt's "Home / Accounts / Pay / Activity / More"
          responsive pattern. This is deliberately NOT the same list as the
          desktop header nav (which shows all four nav_order destinations
          inline): the phone bar's slots have fixed roles, and Categories /
          Reports / Settings live in the More sheet here. Visible below lg:
          (1024px). Absent on auth pages. */}
      {userEmail && (
        <>
          <nav
            aria-label="Primary"
            className="fixed inset-x-0 bottom-0 z-10 border-t border-border-subtle bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
          >
            <div className="mx-auto flex max-w-3xl items-stretch justify-around">
              <BottomNavLink href="/" label="Home" Icon={HomeIcon} pathname={pathname} />
              <BottomNavLink
                href="/transactions"
                label="Transactions"
                Icon={ListIcon}
                pathname={pathname}
              />
              {payEnabled && <PayTrigger variant="mobile" />}
              <BottomNavLink
                href="/budgets"
                label="Budgets"
                Icon={TargetIcon}
                pathname={pathname}
              />
              <button
                type="button"
                onClick={() => setMoreOpen(true)}
                aria-haspopup="dialog"
                aria-expanded={moreOpen}
                aria-current={moreActive ? "page" : undefined}
                className="flex min-w-16 flex-1 flex-col items-center gap-0.5 px-2 py-2.5 text-[11px] font-medium"
              >
                <MoreIcon
                  className={`h-6 w-6 ${moreActive ? "text-accent" : "text-text-muted"}`}
                />
                <span className={moreActive ? "text-accent" : "text-text-muted"}>More</span>
              </button>
            </div>
          </nav>
          <MoreSheet
            open={moreOpen}
            onClose={() => setMoreOpen(false)}
            payEnabled={payEnabled}
            assistedPayEnabled={assistedPayEnabled}
          />
        </>
      )}
    </div>
  );

  return (
    <PrivacyProvider initialHideBalance={hideBalance} privacyMode={privacyMode}>
      <PayProvider
        enabled={Boolean(userEmail) && payEnabled}
        assistedEnabled={Boolean(userEmail) && assistedPayEnabled}
        scanEnabled={Boolean(userEmail) && scanToPayEnabled}
      >
        {shell}
      </PayProvider>
    </PrivacyProvider>
  );
}
