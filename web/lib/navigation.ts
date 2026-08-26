// Single source of truth for the primary application-shell navigation:
// the allowed movable destinations, their default order, and the
// validation every nav-order write (and every stored/cached read) must
// pass through. Both the header/bottom nav rendering and the settings
// "Arrange navigation" screen import from here so they can never drift
// apart - see the master prompt's "avoid maintaining unrelated mobile and
// desktop navigation definitions" requirement.
//
// Home is intentionally NOT a member of this set: it is permanently
// first in the shell and never user-configurable. Reports is
// intentionally NOT a member either: it was removed from primary
// navigation entirely and lives only behind the header icon and the
// Settings "Reports" link.

export const MOVABLE_NAV_KEYS = [
  "transactions",
  "categories",
  "budgets",
  "settings",
] as const;

export type NavKey = (typeof MOVABLE_NAV_KEYS)[number];

export const DEFAULT_NAV_ORDER: NavKey[] = [...MOVABLE_NAV_KEYS];

export const NAV_ITEM_META: Record<NavKey, { href: string; label: string }> = {
  transactions: { href: "/transactions", label: "Transactions" },
  categories: { href: "/categories", label: "Categories" },
  budgets: { href: "/budgets", label: "Budgets" },
  settings: { href: "/settings", label: "Settings" },
};

function isNavKey(value: unknown): value is NavKey {
  return (
    typeof value === "string" &&
    (MOVABLE_NAV_KEYS as readonly string[]).includes(value)
  );
}

/**
 * True only for an array that is an exact permutation of the four
 * allowed movable destinations - no duplicates, no unknown values, no
 * omissions, no wrong length. Mirrors the database's own
 * ui_preferences_nav_order_shape check constraint, so a rejected write
 * here would also be rejected there; kept as an explicit application-
 * level check so we can return a friendly error instead of a raw
 * constraint-violation message.
 */
export function isValidNavOrder(value: unknown): value is NavKey[] {
  if (!Array.isArray(value)) return false;
  if (value.length !== MOVABLE_NAV_KEYS.length) return false;
  if (!value.every(isNavKey)) return false;
  return new Set(value).size === MOVABLE_NAV_KEYS.length;
}

/**
 * Safe fallback for reading a possibly-stale or malformed stored/cached
 * order (e.g. an optimistic localStorage cache written by an older
 * client, or a row that predates a future schema change) - never throws,
 * always returns a valid order, falling back to the default rather than
 * ever passing through something that would render fewer/extra nav items.
 */
export function normalizeNavOrder(value: unknown): NavKey[] {
  return isValidNavOrder(value) ? value : DEFAULT_NAV_ORDER;
}
