// Single source of truth for the application-shell navigation, re-cut
// around the financial lifecycle (assessment section 6.2 / master prompt
// section 19). Both the header nav, the phone bottom bar, and the grouped
// "More" panel derive from here so mobile and desktop can never drift
// into two competing definitions.
//
// The primary nav is a FIXED journey - Home, Transactions, Inbox, Plan,
// More - not a user-orderable list. (The earlier per-user `nav_order` preference
// and its "Arrange navigation" screen are retired; the ui_preferences
// column stays in place, unused, to be dropped in a later deliberate
// migration.) Pay stays an elevated action, rendered specially, not a
// permanent peer route.

import type { SurfaceKey } from "./experience-mode.ts";

export type PrimaryNavKey = "home" | "activity" | "inbox" | "plan";

export type PrimaryNavItem = {
  key: PrimaryNavKey;
  href: string;
  label: string;
  /** Surface gate; `null` = always visible (the core journey). */
  surface: SurfaceKey | null;
};

// Home is permanently first. "Transactions" is the customer-facing label
// for the transaction ledger - existing /transactions deep links stay
// valid (assessment section 43). The `activity` key / `activity` surface
// are unchanged internal identifiers. "Plan" is the mental model over
// budgets + goals + recurring commitments (they keep their own routes
// under /budgets).
export const PRIMARY_NAV: readonly PrimaryNavItem[] = [
  { key: "home", href: "/", label: "Home", surface: null },
  { key: "activity", href: "/transactions", label: "Transactions", surface: "activity" },
  { key: "inbox", href: "/inbox", label: "Inbox", surface: "inbox" },
  { key: "plan", href: "/budgets", label: "Plan", surface: "plan" },
] as const;

// The phone bottom bar: Home, Transactions, the elevated Pay action dead
// centre (rendered by AppShell only when Pay is enabled), Plan, More.
// Inbox is reached from the header icon at phone width (the 5 slots are
// spoken for). Fixed roles - never driven by a preference.
export const PHONE_BAR_KEYS: readonly Exclude<PrimaryNavKey, "home" | "inbox">[] =
  ["activity", "plan"] as const;

// The grouped "More" panel - customer language, not data-model terms
// (assessment section 16 / master prompt section 19). Each item may carry
// a SurfaceKey; AppShell/MoreSheet hides an item whose surface the active
// experience mode does not grant, and additionally honours the Pay /
// integrations feature flags.
// Icon identity per item - resolved to an SVG component in MoreSheet
// (MORE_ICONS), the same key->component indirection AppShell uses for the
// primary nav, so this file stays free of component imports.
export type MoreIconKey =
  | "categories"
  | "reports"
  | "sources"
  | "bills"
  | "members"
  | "settings"
  | "notifications"
  | "integrations"
  | "developer"
  | "ussd"
  | "recipients"
  | "templates";

export type MoreItem = {
  href: string;
  label: string;
  icon: MoreIconKey;
  surface: SurfaceKey | null;
  /** Extra gate beyond the experience mode, checked by MoreSheet. */
  requires?: "integrations" | "pay" | "assistedPay";
};

export type MoreGroup = { title: string; items: readonly MoreItem[] };

// Consolidated (assessment section 16 / master prompt section 19):
//  - Security / Privacy / Appearance are not peers here; they live inside
//    the Settings console (/settings) and are reached from there.
//  - "Payment activity" is opened from the Pay launcher, not listed as a
//    destination here; "Reconciliation" is a shortcut on that activity
//    page, not a standalone More entry.
export const MORE_GROUPS: readonly MoreGroup[] = [
  {
    title: "Manage money",
    items: [
      { href: "/categories", label: "Categories", icon: "categories", surface: "categories" },
      { href: "/reports", label: "Reports", icon: "reports", surface: "reports" },
      { href: "/settings/sources", label: "Connected sources", icon: "sources", surface: "sources" },
      { href: "/bills", label: "Bills", icon: "bills", surface: "bills" },
    ],
  },
  {
    title: "This Space",
    items: [
      { href: "/settings/workspace", label: "Space & members", icon: "members", surface: "members" },
    ],
  },
  {
    title: "Account",
    items: [
      { href: "/settings", label: "Settings", icon: "settings", surface: null },
      { href: "/settings/notifications", label: "Notifications", icon: "notifications", surface: null },
    ],
  },
  {
    title: "Advanced",
    items: [
      {
        href: "/integrations",
        label: "Integrations",
        icon: "integrations",
        surface: "integrations",
        requires: "integrations",
      },
      {
        href: "/integrations/developer",
        label: "Developer platform",
        icon: "developer",
        surface: "developer",
        requires: "integrations",
      },
    ],
  },
  {
    title: "Pay & Services",
    items: [
      { href: "/pay/ussd", label: "USSD directory", icon: "ussd", surface: "pay", requires: "pay" },
      {
        href: "/pay/recipients",
        label: "Trusted recipients",
        icon: "recipients",
        surface: "pay",
        requires: "assistedPay",
      },
      {
        href: "/pay/templates",
        label: "Payment templates",
        icon: "templates",
        surface: "pay",
        requires: "assistedPay",
      },
    ],
  },
] as const;

// Routes that mark the "More" nav item as the active destination. `/inbox`
// is NOT here - it is a primary destination now.
export const MORE_MENU_PREFIXES = [
  "/integrations",
  "/categories",
  "/reports",
  "/bills",
  "/settings",
  "/pay",
] as const;

// Retained only as the literal still written into the vestigial
// ui_preferences.nav_order column by the get-started / appearance upserts
// (which preserve-or-default every column they don't own). Nothing reads
// it any more.
export const LEGACY_DEFAULT_NAV_ORDER: readonly string[] = [
  "transactions",
  "categories",
  "budgets",
  "settings",
] as const;
