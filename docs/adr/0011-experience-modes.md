# ADR 0011: Experience modes (Personal / Household / Business)

- **Status:** Accepted for staged implementation (PR1: pure model + nav
  surface-visibility wiring; Business surfaces dark)
- **Date:** 2026-09-05
- **Builds on:** ADR 0005 (Spaces tenancy & source visibility). Does not
  change any authorization primitive.
- **Context:** OneLedger's surface area (~96 routes: Pay, Integrations,
  Bills, developer platform, directory admin, reconciliation, accounting
  connectors) has outgrown a single flat product experience. A Personal
  user should never have to see, or navigate past, business finance
  administration to reach their own ledger (platform assessment section
  6.2, master prompt section 18).

## Decision

### 1. Three modes, derived from the Space's `kind`

`ExperienceMode = "personal" | "household" | "business"`, resolved from the
**active** workspace's existing `kind` column (`20260910` phase Q):

| `workspaces.kind` | mode |
| --- | --- |
| `personal` | `personal` |
| `household` | `household` |
| `organization` | `business` |

No new column, no migration. "Switching mode" is switching Space in the
workspace switcher — which already exists and matches the mental model
(you open your Household Space to collaborate; your registered business is
an `organization` Space). A future per-user "show me the simpler surface
even in this Space" override can layer onto `ui_preferences` without
changing this mapping.

### 2. The mode decides visibility, never authorization

The mode filters which **surfaces** (coarser than routes — a whole area
like "developer" or "bills") appear in navigation and are offered to the
user. It is **not** an access-control check. What a member may actually do
is unchanged: membership + role + capability + resource scope, enforced by
RLS and the SECURITY DEFINER RPCs (`docs/authorization-matrix.md`). A
hidden surface whose server action is still called without the capability
must still fail closed — and does.

Surface sets (`web/lib/experience-mode.ts`):

- **personal:** home, activity, inbox, plan, reports, categories, sources,
  pay.
- **household:** + members, per-member attribution, import/export
  integrations.
- **business:** + bills, reconciliation centre, accounting connectors,
  developer platform.

`directory_admin` is operator tooling and is never granted by a product
mode (it keeps its own `DIRECTORY_ADMIN_ENABLED` flag).

### 3. Business surfaces are dark by default

An `organization` Space resolves to `business` mode (so copy and labels are
correct) but the business-only surfaces render as the household set until
`EXPERIENCE_MODE_BUSINESS_ENABLED = "true"`
(+ optional `EXPERIENCE_MODE_BUSINESS_ALLOWLIST`). This ADR does **not**
introduce any new Business feature — it only groups already-shipped,
already-flagged surfaces (Bills, Integrations Phase 3/4) under a mode.
Guardrail: no custom roles, SSO, or org-policy console until real Business
usage demands them.

## Consequences

- `web/lib/navigation.ts` stays the single nav source of truth; the shell
  filters its output through `isSurfaceVisible(mode, key, { businessEnabled })`.
- The structural nav re-cut (Home / Activity / Inbox / Plan / More with a
  grouped "More") is a separate change — it needs regenerated visual/e2e
  baselines — and consumes this model when it lands.
- Onboarding intent selection (Release 3) writes the Space kind that
  produces the chosen mode; it does not need its own mode store.
