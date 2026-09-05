// The OneLedger experience mode: Personal, Household, or Business
// (assessment section 6.2, master prompt section 18). It decides which
// product surfaces are even *visible* to a user - a Personal user never
// sees the Pay directory admin, accounting connectors, or the developer
// platform. It is an experience configuration, NOT an authorization
// boundary: what a member may actually DO still comes from membership +
// role + capability + resource scope (docs/authorization-matrix.md).
//
// The mode is derived from the active Space's `kind`, so "switching mode"
// is just switching Space in the workspace switcher - which matches the
// mental model (you go to your Household Space to collaborate; your
// registered business is an `organization` Space):
//
//   workspaces.kind = 'personal'      -> "personal"
//   workspaces.kind = 'household'     -> "household"
//   workspaces.kind = 'organization'  -> "business"
//
// No migration: `kind` already carries these three permanently-distinct
// values (20260910 phase Q). A future per-user "show me the simpler
// surface even in this Space" override can layer on ui_preferences later.

export const EXPERIENCE_MODES = ["personal", "household", "business"] as const;
export type ExperienceMode = (typeof EXPERIENCE_MODES)[number];

export type WorkspaceKind = "personal" | "household" | "organization";

export function experienceModeForWorkspaceKind(
  kind: WorkspaceKind | string | null | undefined,
): ExperienceMode {
  if (kind === "organization") return "business";
  if (kind === "household") return "household";
  return "personal";
}

// Every gate-able product surface. A surface key is coarser than a route:
// it groups a whole area ("developer", "pay") so one entry decides both
// the nav item and the pages under it. Nav re-cut (assessment item 8)
// consumes `isSurfaceVisible` when filtering navigation.ts.
export const SURFACE_KEYS = [
  "home",
  "activity", // transactions ledger
  "inbox",
  "plan", // budgets + goals
  "reports",
  "categories", // category rules / insights
  "sources", // connected sources + devices
  "pay", // assisted pay
  "bills",
  "members", // Space members + invites
  "attribution", // per-member transaction attribution
  "integrations", // import/export/sync/destinations/workbooks
  "reconciliation", // reconciliation center
  "accounting_connectors", // accounting-package + ledger connectors
  "developer", // /api/v1 keys, webhooks, marketplace
  "directory_admin", // /admin/directory, /admin/ussd
] as const;
export type SurfaceKey = (typeof SURFACE_KEYS)[number];

// Surfaces every mode shows.
const COMMON: SurfaceKey[] = [
  "home",
  "activity",
  "inbox",
  "plan",
  "reports",
  "categories",
  "sources",
  "pay",
];

// Additive per mode. `business` is a superset of `household` is a superset
// of `personal` for surfaces, though the modes are not otherwise ordered.
//   household  adds collaboration + the plain import/export tooling.
//   business   adds bills, reconciliation, accounting connectors and the
//              developer platform - the surfaces the assessment names as
//              ones "a personal user should never see".
const EXTRA: Record<ExperienceMode, SurfaceKey[]> = {
  personal: [],
  household: ["members", "attribution", "integrations"],
  business: [
    "members",
    "attribution",
    "integrations",
    "bills",
    "reconciliation",
    "accounting_connectors",
    "developer",
  ],
};

// `directory_admin` is operator tooling gated by its own DIRECTORY_ADMIN_ENABLED
// flag and never appears in a normal product mode - listed in SURFACE_KEYS so
// the nav filter is exhaustive, but no mode grants it here.

/**
 * Business-only surfaces stay dark until the Business rollout flag is on
 * (guardrail: "Business rollout should remain feature gated"). Until then a
 * `business` Space shows the Household surface set. Pass the resolved flag
 * from a server gate; defaults to false so nothing new lights up by import.
 */
export function isSurfaceVisible(
  mode: ExperienceMode,
  surface: SurfaceKey,
  opts: { businessEnabled?: boolean } = {},
): boolean {
  const effective: ExperienceMode = mode === "business" && !opts.businessEnabled
    ? "household"
    : mode;
  if (COMMON.includes(surface)) return true;
  return EXTRA[effective].includes(surface);
}

export function visibleSurfaces(
  mode: ExperienceMode,
  opts: { businessEnabled?: boolean } = {},
): SurfaceKey[] {
  return SURFACE_KEYS.filter((s) => isSurfaceVisible(mode, s, opts));
}

export function experienceModeLabel(mode: ExperienceMode): string {
  return mode === "business"
    ? "Business"
    : mode === "household"
    ? "Household"
    : "Personal";
}
