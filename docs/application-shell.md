# Application shell, navigation, and dashboard privacy

The unified authenticated shell (header, primary navigation, profile menu),
the 5-item primary navigation with user-configurable ordering, balance/
dashboard privacy mode, and the Home dashboard's budget-status/attention-
items cards. Documents the system as implemented, not the originating
master prompt verbatim - see git history (branch `feat/app-shell-nav-
privacy-e2e`, PR #12) for how it evolved, including two real incidents hit
and fixed along the way (a migration-sequencing gap that had blocked a
fresh `supabase start` since Phase B, and a missing `EXECUTE` grant that
silently broke every preference save in production - see "Incidents" below).

## Where each piece lives

| Concern | Location |
|---|---|
| Schema, RLS, nav-order validation | `supabase/migrations/20260904000000_phase_l_ui_preferences.sql` |
| Follow-up grant fix (see Incidents) | `supabase/migrations/20260905000000_phase_l_grant_is_valid_nav_order_execute.sql` |
| Nav allowlist/validation (shared client+server) | `web/lib/navigation.ts` |
| Preference read (server-scoped, safe defaults) | `web/lib/queries.ts`'s `getUiPreferences()` |
| Nav-order/notice-dismissal writes | `web/app/settings/appearance/actions.ts` |
| Balance-visibility/privacy-mode writes | `web/app/settings/privacy/actions.ts` |
| Shell shell itself (header, both navs, profile menu wiring) | `web/components/AppShell.tsx` |
| Profile menu (email, workspace switcher, settings links, sign-out) | `web/components/ProfileMenu.tsx` |
| Header Reports icon | `web/components/ReportsButton.tsx` |
| One-time Reports-relocation notice | `web/components/ReportsRelocationNotice.tsx` |
| Privacy state + optimistic balance toggle | `web/components/PrivacyProvider.tsx` |
| Settings UI: nav reorder | `web/components/NavOrderForm.tsx`, `web/app/settings/appearance/page.tsx` |
| Settings UI: privacy | `web/components/PrivacyPreferencesForm.tsx`, `web/app/settings/privacy/page.tsx` |
| Balance card + masking | `web/components/BalanceCard.tsx`, `web/components/MoneyAmount.tsx` |
| Dashboard budget/attention cards | `web/components/BudgetStatusCard.tsx`, `web/components/AttentionItemsCard.tsx`, both fed by `getDashboardBudgetSummary()`/`getAttentionItems()` in `web/lib/queries.ts` |
| Home dashboard layout (mobile stack / desktop 2-col grid) | `web/app/page.tsx` |
| e2e/visual-regression/accessibility suite | `web/e2e/**`, see `web/e2e/README.md` |
| CI (required gate + baseline maintenance) | `.github/workflows/ci.yml`'s `e2e-tests` job, `.github/workflows/generate-e2e-baselines.yml` |

## Navigation

Primary navigation is always exactly 5 destinations: **Home**, fixed first
and never movable, followed by **Transactions, Categories, Budgets,
Settings** in whatever order the user has saved. Reports was deliberately
removed from this list - it's reachable from the header's document icon
(`ReportsButton`, "Open reports") on every screen, and from a "Reports"
entry in Settings (distinct from "Daily reports", which configures
scheduled generation, not navigation to the report list itself).

The same `navOrder` value drives both the desktop header nav and the
mobile bottom nav - one array, two renderings, never two independent
navigation definitions to keep in sync (`AppShell.tsx`'s
`useOrderedNavItems`).

**Validation** (`lib/navigation.ts`, mirrored by a database CHECK
constraint) accepts nothing but an exact permutation of `transactions`,
`categories`, `budgets`, `settings` - no duplicates, no unknown values, no
omissions, and `home`/`reports` can never appear in the stored array at
all. A malformed value anywhere (a stale local cache, a manually-edited
row) normalizes to the default order rather than rendering fewer or extra
nav items.

**Persistence and sync**: `ui_preferences` is one row per
`(workspace_id, user_id)`, RLS-scoped so a user can only ever read/write
their own row. The root layout (`app/layout.tsx`) fetches it once,
server-side, and threads it down as props - no separate client fetch in
the header, mobile nav, or dashboard, and no flash of the default order
before the real one loads. Saving from Settings re-renders the whole app
shell (`revalidatePath("/", "layout")`), so a saved order appears
immediately and identically on every device the user is signed into,
without needing to be online at the same moment - there is no
device-to-device messaging, each device just reads the same server row on
its own next load.

## Balance and dashboard privacy

Two independent, layered controls, both stored on the same
`ui_preferences` row:

- **`hide_balance`** - the Current Balance card's eye/eye-off toggle.
  Masks only the main balance. Toggled directly from the dashboard,
  optimistic (flips instantly, rolls back if the save fails - see
  `PrivacyProvider.toggleBalanceVisible`).
- **`privacy_mode`** - "Full financial privacy mode", toggled only from
  Settings → Privacy and security. Masks every sensitive dashboard figure
  (balance, today's totals, budget remaining, the dashboard's recent-
  transactions preview amounts) - it implies `hide_balance` and disables
  the eye toggle while active (with an accessible name explaining why,
  not just a silently inert button).

**Masking never touches a real value.** `MoneyAmount`'s `masked` prop
renders a fixed-width `••••••` placeholder and an `aria-label="Amount
hidden"` - the real number is never placed in the DOM, an accessible name,
a title, a log line, or an analytics payload while masked (there is
nothing to leak, by construction, not by convention).

**First-paint safety**: both flags come from the same server-side
`getUiPreferences()` fetch in the root layout, so the very first rendered
HTML already reflects them - there is no client-side effect that reveals
a real value for one frame before hiding it.

**Display privacy is not access security.** Masking a number changes
nothing about who can read it: Supabase RLS is the only real
authorization boundary, unaffected by `hide_balance`/`privacy_mode` in
every direction - a masked value is still fetched with full precision
server-side (never redacted in the query itself, only in what the client
renders), and Reports/PDF export/the API never consult these flags at
all. See `ui_preferences_nav_order_shape`'s and the two settings actions
files' own comments for where this line is drawn explicitly in code.

## Dashboard layout

Single column on mobile/tablet, in document order: balance, today's
totals, budget status, attention items, recent transactions
(`app/page.tsx`). At the `lg:` breakpoint (1024px) this becomes a 2:1 CSS
grid - the wide left column keeps balance/totals/transactions, budget-
status/attention-items move into the narrower right column via explicit
`col-start-3`/`row-start-*` placement. **Document order never changes
between breakpoints** - there is no separate desktop markup, only CSS
placement, so keyboard/screen-reader reading order is identical
everywhere. When neither budget status nor an attention item exists (a
new or quiet account), the main column expands to the full grid width
instead of leaving a permanently blank third column.

Budget-status and attention-items cards are both **omitted entirely**
(not rendered as an empty-state box) when there's nothing to show - a
quiet dashboard on a quiet day is the correct state, not a broken one.
Attention items currently cover uncategorized/needs-review transactions,
pending learned-categorization-rule suggestions, and budget allocations
in `warning`/`critical` status - each backed by an existing, already-
reliable query (`getReviewQueueCount`, `getLearnedPolicySuggestionCount`,
the active budget's own alerts). Duplicate/suspicious-transaction
detection, failed-import tracking, and stale-account-data detection are
**not** implemented - there is no reliable signal for any of them yet in
this codebase, and inventing one solely to populate this card was
explicitly out of scope; the query has a documented seam
(`getAttentionItems` in `lib/queries.ts`) for adding one later.

## Accessibility

Automated coverage (`web/e2e/accessibility.spec.ts`) scans Home, Settings,
Appearance, and Privacy for serious/critical axe violations, and checks
44×44 CSS-pixel minimum touch targets and 200%-zoom layout on the shell's
interactive controls. Manually verified in this work: every icon-only
control has an accessible name (`ReportsButton`, the profile menu trigger,
the balance eye toggle); the profile menu supports Escape-to-close with
focus returned to its trigger, and click-outside; nav reordering has a
fully keyboard-accessible path (focus a Move up/down button, press Enter)
with no drag-and-drop-only mechanism, plus an `aria-live` announcement per
move. **Not** covered by this task: a full manual screen-reader pass,
high-contrast/forced-colors mode, or `prefers-reduced-motion` audit across
the whole app (the shell's own transitions are already minimal -
`transition-colors` only, no motion to reduce).

## Analytics and monitoring

**No product-analytics system exists anywhere in this codebase** (no
PostHog/Segment/Amplitude/similar - confirmed by searching the whole
`web/` tree). Master prompt §16 is explicit that this work must use
existing analytics/monitoring infrastructure and must not introduce a
separate system solely for it - so no event tracking (Reports opened,
nav order saved, privacy mode toggled, etc.) was added. Wiring events
into a system that doesn't exist would just be dead code; if a real
analytics provider is ever added, `PrivacyProvider`'s toggle handlers and
the two settings actions files (`appearance/actions.ts`,
`privacy/actions.ts`) are the natural, already-centralized call sites for
the events §16.1 lists.

What **does** exist and was extended:

- **`app/global-error.tsx`** (new) - Next.js's own root-layout error
  boundary. `app/error.tsx` only ever covered page segments, never
  `app/layout.tsx` itself, which is where the shell (`AppShell`, both
  navs, the profile menu, `PrivacyProvider`) actually renders - a bug
  there had no recovery UI at all before this. Same restrained,
  no-internal-detail tone as `error.tsx`; logs only the JS `Error` object
  to `console.error`, never a preference, balance, or transaction value.
- **`console.error` logging** on every Supabase call in the preference
  read/write path (`getUiPreferences`, and both settings actions files'
  `upsertUiPreferences` helpers) - already this codebase's established
  pattern (`lib/queries.ts`'s other `getX failed: ...` calls), extended
  to the new code rather than introduced fresh. Logs the Postgres error
  message/detail/hint/code only - never the payload that triggered it,
  so a failed save is diagnosable without ever logging a nav order,
  balance-visibility flag, or anything user-entered.

What is **not** covered, honestly: there is no dashboard or alerting on
error *rates* (preference-API failure rate, hydration mismatches,
layout-shift regressions, etc.) - that requires an actual observability
backend (Sentry, Vercel Observability, Datadog, ...), and none is wired
into this project today. `console.error` calls are visible in Vercel's
own function logs for ad hoc debugging, but nothing aggregates or alerts
on them. Adding that is a real, separate infrastructure decision for
whoever operates this project, not something to bolt on silently as a
side effect of this feature.

## Feature flags and rollout

**No feature flag gates this work.** The one existing flag-like pattern
in this codebase - `REPORT_GENERATION_ENABLED`/
`REPORT_EMAIL_DELIVERY_ENABLED` (`lib/report-generation.ts`,
`lib/report-delivery.ts`) - is an operational kill switch justified by a
real external side effect: reports send real emails, and the switch
exists specifically to pause that without deleting any data. Nothing in
this shell/navigation/privacy/dashboard work has an equivalent external
effect to pause; a bug here is a broken UI, not an outbound email or a
data-mutating background job.

Master prompt §17 itself allows skipping flags when "the current release
process does not require [them] and the change can be safely deployed
through preview and staging" - which is exactly this project's process
(Vercel preview → production, gated by this PR's own CI: Deno, migration/
RLS tests, and the e2e/accessibility/visual-regression suite). Building a
flag here would also mean keeping the *entire prior shell implementation*
alive side-by-side just to toggle back to it - real, ongoing duplication
for a rollback path that a plain `git revert` (or redeploying the prior
Vercel production build) already covers at no extra cost, since this
change replaces the old shell rather than running alongside it.

The one already-shipped migration in this body of work
(`ui_preferences`) is additive-only and independently covered by its own
rollback story - see "Incidents" above and the migration files'
comments - which is a database-schema concern this section deliberately
doesn't duplicate.

## Testing

- **Unit** (`web/lib/navigation_test.ts`, `deno test web/lib`): nav-order
  allowlist validation and default-order fallback.
- **Migration/RLS** (`supabase/migrations/tests/run_migration_tests.sh`):
  `ui_preferences`' RLS policies, the nav-order shape CHECK constraint's
  accept/reject behavior, and the exact-count privilege guardrails (27 of
  28 tables RLS-enabled - `auth_login_attempts` is the one documented
  exception, 55 authenticated table grants, 15 authenticated function
  grants after the full chain).
- **e2e/accessibility/visual-regression** (`web/e2e/**`, Playwright): see
  `web/e2e/README.md` for the full breakdown - shell/nav behavior, nav
  reordering, privacy masking and persistence, automated accessibility,
  and visual-regression baselines (both macOS and Linux committed; CI
  compares against Linux). Runs against a disposable local Supabase stack
  only, never the linked production project (`e2e/production-guard.ts`).

## Incidents

Two real, previously-undiscovered gaps this work surfaced, both fixed and
worth knowing about for future migrations touching this schema or a
disposable-database test:

1. **`supabase start` had never actually succeeded from empty** - a
   pre-existing migration (`20260821000100_phase_b_ownership_backfill_
   and_constraints.sql`) required a real user signup to happen *between*
   it and the migration before it, which only ever happened in
   production (a real signup) or in the test harness (a synthetic one) -
   never in a single non-interactive `supabase start` pass. Fixed by
   letting that migration self-heal (create its own ownerless placeholder
   workspace) when it finds zero personal workspaces, rather than
   raising - see that migration's own updated comments.
2. **A CHECK constraint's helper function needs its own `EXECUTE` grant.**
   `is_valid_nav_order()` (called from `ui_preferences_nav_order_shape`,
   not `SECURITY DEFINER`) silently had no grant to `authenticated`,
   because `20260819000000_harden_function_and_sequence_default_
   privileges.sql` (already in place) revokes the default grant every new
   function would otherwise receive - every other RPC-style function in
   this schema has its own explicit grant for exactly this reason, and
   this one was missed. The result: every real nav-order/privacy save
   failed silently in production until the follow-up migration was
   pushed. Added to `supabase/migrations/README.md`'s pre-migration
   checklist so it isn't missed again.
