// Entitlements & plan tiers - the single source of truth for the
// tier -> capability map (ADR 0015 / master prompt section 52). Pure and
// framework-free so it is unit-testable and importable from both server
// and (future) client code. The SQL side (20261130000000) only STORES a
// workspace's plan; it never encodes this map.
//
// Guardrail (assessment section 7): an entitlement gates automation
// volume, collaboration, and operational control ONLY. A user's own
// ledger, data export, account deletion, and security are NEVER behind a
// plan - do not add such an entitlement here.

export const PLANS = [
  "free",
  "personal_plus",
  "household",
  "business",
] as const;
export type Plan = (typeof PLANS)[number];

export function isPlan(value: unknown): value is Plan {
  return typeof value === "string" && (PLANS as readonly string[]).includes(value);
}

export const ENTITLEMENTS = [
  // Automation volume.
  "automated_ingestion",
  "multiple_sources",
  "categorization_rules",
  "scheduled_reports",
  "extended_history",
  "cash_flow_forecast",
  // Collaboration.
  "shared_space",
  "space_members",
  "shared_goals",
  "shared_inbox",
  "source_sharing",
  // Operational control.
  "multi_account_workspace",
  "finance_roles",
  "approvals",
  "bills",
  "reconciliation",
  "professional_reports",
  "audit_retention",
] as const;
export type Entitlement = (typeof ENTITLEMENTS)[number];

const PERSONAL_PLUS: Entitlement[] = [
  "automated_ingestion",
  "multiple_sources",
  "categorization_rules",
  "scheduled_reports",
  "extended_history",
  "cash_flow_forecast",
];

const HOUSEHOLD: Entitlement[] = [
  ...PERSONAL_PLUS,
  "shared_space",
  "space_members",
  "shared_goals",
  "shared_inbox",
  "source_sharing",
];

const BUSINESS: Entitlement[] = [
  ...HOUSEHOLD,
  "multi_account_workspace",
  "finance_roles",
  "approvals",
  "bills",
  "reconciliation",
  "professional_reports",
  "audit_retention",
];

// Higher tiers are supersets of lower ones, but the tiers are not
// otherwise ordered (Household and Personal Plus are parallel products).
const PLAN_ENTITLEMENTS: Record<Plan, readonly Entitlement[]> = {
  free: [],
  personal_plus: PERSONAL_PLUS,
  household: HOUSEHOLD,
  business: BUSINESS,
};

export function planEntitlements(plan: Plan): readonly Entitlement[] {
  return PLAN_ENTITLEMENTS[plan];
}

export function planHasEntitlement(plan: Plan, entitlement: Entitlement): boolean {
  return PLAN_ENTITLEMENTS[plan].includes(entitlement);
}

export function planLabel(plan: Plan): string {
  switch (plan) {
    case "free":
      return "Free";
    case "personal_plus":
      return "Personal Plus";
    case "household":
      return "Household";
    case "business":
      return "Business";
  }
}

/**
 * The lowest plan that grants an entitlement - for "upgrade to X to
 * unlock this" messaging. Returns null for an entitlement no plan grants
 * (shouldn't happen; defensive).
 */
export function lowestPlanFor(entitlement: Entitlement): Plan | null {
  return PLANS.find((p) => planHasEntitlement(p, entitlement)) ?? null;
}
