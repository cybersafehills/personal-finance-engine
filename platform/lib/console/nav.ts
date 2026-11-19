import { can, type Access } from "./permissions.ts";

// Navigation map from the console spec. `href` is set ONLY for modules that
// are actually built; everything else is rendered as a non-interactive
// "Soon" entry so no control pretends to work.
export type NavItem = {
  label: string;
  href?: string;
  permission?: string;
};
export type NavGroup = { label: string; items: NavItem[] };

export const NAV: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { label: "Executive Dashboard", href: "/dashboard", permission: "view_aggregate_metrics" },
      { label: "Activity Center" },
      { label: "Reports & Intelligence" },
    ],
  },
  {
    label: "Customers",
    items: [
      { label: "Users" },
      { label: "Registrations" },
      { label: "Organizations" },
      { label: "Customer Support" },
    ],
  },
  {
    label: "Revenue",
    items: [
      { label: "Subscriptions" },
      { label: "Billing & Payments" },
      { label: "Revenue Analytics" },
      { label: "Refunds & Reconciliation" },
    ],
  },
  {
    label: "Security",
    items: [
      { label: "Security Center" },
      { label: "Access Management", href: "/security/access", permission: "view_staff" },
      { label: "Audit Logs", href: "/security/audit-logs", permission: "view_audit_logs" },
      { label: "Incidents" },
    ],
  },
  {
    label: "Platform",
    items: [
      { label: "System Health", href: "/platform/health", permission: "view_system_health" },
      { label: "Integrations" },
      { label: "Communications" },
      { label: "Feature Management" },
      { label: "Configuration" },
    ],
  },
  {
    label: "Administration",
    items: [{ label: "Approvals" }, { label: "Administrative Actions" }],
  },
];

export type ResolvedNavItem = NavItem & { state: "link" | "soon" };

/** Built + permitted -> link; unbuilt -> soon; built but not permitted -> omitted. */
export function resolveNav(access: Access): { label: string; items: ResolvedNavItem[] }[] {
  return NAV.map((g) => ({
    label: g.label,
    items: g.items.flatMap((i): ResolvedNavItem[] => {
      if (!i.href) return [{ ...i, state: "soon" }];
      if (i.permission && !can(access, i.permission)) return [];
      return [{ ...i, state: "link" }];
    }),
  })).filter((g) => g.items.length > 0);
}
