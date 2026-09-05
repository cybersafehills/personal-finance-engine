# Settings information architecture

- **Status:** implemented (branch `feat/settings-ia-7group`, stacked on the
  Release 2 nav re-cut in `pfe/consolidation-2-core`).
- **Master prompt:** sections 22-30 and section 110.
- **Source of truth:** `web/lib/settings-navigation.ts`. The Settings home
  (`web/app/settings/page.tsx`) renders straight from it, so the page and this
  document cannot drift.

## Why

The old Settings home was a flat, unordered list of ten rows whose names
overlapped ("Appearance and navigation", "Privacy and security", **and** a
separate "Security"; "Accounts", "Connections", **and** "Shared accounts";
"Spaces" **and** "Shared accounts"). A user could not tell where a given
setting lived, and "Shared accounts" was exposed as a top-level product
concept when it is really a per-Space visibility choice on an account.

## The seven groups

| Group | Purpose | Rows (→ route) |
| --- | --- | --- |
| **Profile & Preferences** | Your details, regional defaults, shell layout | Profile & region → `/settings/profile` · Appearance & navigation → `/settings/appearance` |
| **Accounts & Connections** | Where money lives + how transactions arrive | Financial accounts → `/settings/accounts` · Connections & devices → `/integrations/connections` · Import a statement → `/settings/sources/import` |
| **Spaces & Members** | Personal / Household / Organization + access | Spaces & members → `/settings/workspace` · Account sharing → `/settings/sources` |
| **Reports & Notifications** | Scheduled summaries + shared-Space alerts | Reports → `/settings/reports` · Notifications → `/settings/notifications` |
| **Data & Integrations** | Import / export / external services | Integrations → `/integrations` · Developer platform → `/integrations/developer` |
| **Security & Privacy** | Sign-in protection + on-screen privacy | Sign-in & security → `/settings/security` · Privacy → `/settings/privacy` |
| **Billing & Plan** | Current plan and what it includes | Plan → `/settings/billing` |

## Visibility

`visibleSettingsGroups(ctx)` filters rows, then drops any group left empty:

- `requiresSpaces` rows (**Account sharing**) are hidden unless
  `isSpacesEnabled(activeWorkspaceId)`.
- `surface` rows are hidden unless the row's `SurfaceKey` is visible in the
  active experience mode (`isSurfaceVisible`, `lib/experience-mode.ts`). A
  Personal Space therefore never sees **Data & Integrations** (both its rows
  are surface-gated and neither `integrations` nor `developer` is in the
  Personal surface set); a Household sees **Integrations** but not the
  **Developer platform**.

Visibility here is presentation only. Every action behind these pages
re-checks membership + role + capability + resource scope
(`docs/authorization-matrix.md`).

## Routing

No routes moved. Every row deep-links to a page that already existed, except
two new leaf pages:

- **`/settings/profile`** — post-onboarding editing of the name + regional
  fields. Reuses the `save_onboarding_profile` / `save_onboarding_preferences`
  RPCs via the existing `saveProfileOnboarding` / `saveFinancialPreferences`
  server actions, so there is one validated write path; the only difference
  from the onboarding steps is that success stays on the page.
- **`/settings/billing`** — a static home for the plan. The entitlements
  domain and any payment processing are a later phase
  (`ONELEDGER_PLATFORM_ASSESSMENT.md` section 6.6); until then every account
  is on the free plan and the page says so. **Do not** hardcode plan-gated
  behaviour against this copy — that will read a central entitlement check.

The two previously separate Security entries are one group with two pages
(`/settings/security` for sign-in/MFA/sessions, `/settings/privacy` for
on-screen visibility). `/settings/connections` still permanent-redirects to
`/integrations/connections` (unchanged, Release 2).

## Not in this change

- The grouped **More** sheet (`lib/navigation.ts` `MORE_GROUPS`) is a
  separate nav surface owned by the Release 2 re-cut; it already groups its
  quick links and is left as-is here.
- Account-detail as a tabbed object (Overview / Transactions / Connections /
  Rules / Access / Settings — master prompt section 16/24) is a distinct gap,
  tracked in `docs/oneledger-onboarding-architecture-audit.md` §2 (G3).
