import { can, type Access } from "./permissions.ts";

// Navigation map. An item is a link only when it is BUILT (`href` set) and the
// role may use it; every other item renders as a non-interactive "Soon" entry.
// `icon` is a key into components/ui/Icon.tsx (strings, so the map can cross
// the server -> client boundary).
export type NavItem = {
  label: string;
  icon: string;
  href?: string;
  permission?: string;
  description?: string;
};
export type NavGroup = { label: string; items: NavItem[] };

export const NAV: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { label: "Executive Dashboard", icon: "layout", href: "/dashboard", permission: "view_aggregate_metrics", description: "Platform-wide health, growth and queue" },
      { label: "Activity Center", icon: "activity", href: "/overview/activity", permission: "view_aggregate_metrics", description: "Every registration and administrative action" },
      { label: "Reports & Intelligence", icon: "chart", href: "/overview/reports", permission: "view_aggregate_metrics", description: "Growth, activation funnel and plan mix" },
    ],
  },
  {
    label: "Customers",
    items: [
      { label: "Users", icon: "users", href: "/customers/users", permission: "view_customer_metadata", description: "Customer accounts (metadata only)" },
      { label: "Registrations", icon: "userplus", href: "/customers/registrations", permission: "view_customer_metadata", description: "Sign-up and verification state" },
      { label: "Organizations", icon: "building", href: "/customers/organizations", permission: "view_customer_metadata", description: "Business workspaces" },
      { label: "Customer Support", icon: "lifebuoy" },
    ],
  },
  {
    label: "Revenue",
    items: [
      { label: "Subscriptions", icon: "repeat" },
      { label: "Billing & Payments", icon: "card" },
      { label: "Revenue Analytics", icon: "trend" },
      { label: "Refunds & Reconciliation", icon: "receipt" },
    ],
  },
  {
    label: "Security",
    items: [
      { label: "Security Center", icon: "shield", href: "/security", permission: "view_audit_logs", description: "Privileged activity and access posture" },
      { label: "Access Management", icon: "key", href: "/security/access", permission: "view_staff", description: "Staff, roles and permissions" },
      { label: "Audit Logs", icon: "scroll", href: "/security/audit-logs", permission: "view_audit_logs", description: "Append-only audit trail" },
      { label: "Incidents", icon: "siren" },
    ],
  },
  {
    label: "Platform",
    items: [
      { label: "System Health", icon: "heart", href: "/platform/health", permission: "view_system_health", description: "Pipeline and job health" },
      { label: "Integrations", icon: "plug" },
      { label: "Communications", icon: "mail" },
      { label: "Feature Management", icon: "flag" },
      { label: "Configuration", icon: "sliders" },
    ],
  },
  {
    label: "Administration",
    items: [
      { label: "Approvals", icon: "check" },
      { label: "Administrative Actions", icon: "gavel" },
    ],
  },
];

export type ResolvedNavItem = NavItem & { state: "link" | "soon" };
export type ResolvedNavGroup = { label: string; items: ResolvedNavItem[] };

/** Built + permitted -> link; unbuilt -> soon; built but not permitted -> omitted. */
export function resolveNav(access: Access): ResolvedNavGroup[] {
  return NAV.map((g) => ({
    label: g.label,
    items: g.items.flatMap((i): ResolvedNavItem[] => {
      if (!i.href) return [{ ...i, state: "soon" }];
      if (i.permission && !can(access, i.permission)) return [];
      return [{ ...i, state: "link" }];
    }),
  })).filter((g) => g.items.length > 0);
}

/** Longest-prefix match so /security/audit-logs beats /security. */
export function activeHref(pathname: string, groups: ResolvedNavGroup[]): string | null {
  let best: string | null = null;
  for (const g of groups) {
    for (const i of g.items) {
      if (!i.href || i.state !== "link") continue;
      if (pathname === i.href || pathname.startsWith(`${i.href}/`)) {
        if (!best || i.href.length > best.length) best = i.href;
      }
    }
  }
  return best;
}

export function breadcrumbFor(
  pathname: string,
  groups: ResolvedNavGroup[],
): { group: string; label: string } | null {
  const href = activeHref(pathname, groups);
  if (!href) return null;
  for (const g of groups) {
    const item = g.items.find((i) => i.href === href);
    if (item) return { group: g.label, label: item.label };
  }
  return null;
}
