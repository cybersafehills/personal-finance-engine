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
| Production rollout / post-deployment smoke tests | `docs/app-shell-rollout-runbook.md` |

## Navigation

Two renderings, deliberately **not** the same list:

- **Tablet / desktop header nav (`>= lg`)** - exactly 5 destinations:
  **Home**, fixed first and never movable, followed by **Transactions,
  Categories, Budgets, Settings** in whatever order the user has saved.
  Driven by `navOrder` (`AppShell.tsx`'s `useOrderedNavItems`).
- **Phone bottom bar (`< lg`)** - a **fixed** five: `Home ·
  Transactions · [Pay] · Budgets · More`, with the elevated **Pay**
  action dead-centre (two destinations either side), matching the master
  prompt's `Home / Accounts / Pay / Activity / More` responsive pattern.
  The slots have fixed roles, so this bar is **not** reordered by
  `navOrder`. **Categories, Reports, and Settings** live in the **More**
  bottom sheet (`components/MoreSheet.tsx`) here, alongside a Pay &
  Services group (USSD directory, Payment activity, Reconciliation,
  Trusted recipients, Templates) when those flags are on. `MoreSheet`
  reuses `PayLauncher`'s modal mechanics (Esc/backdrop close, focus trap,
  focus restore, scroll lock, `role="dialog"`). `lib/navigation.ts`
  exports `MOBILE_BAR_KEYS` and `MORE_MENU_PREFIXES` (the routes that mark
  "More" active).

Reports was deliberately removed from primary navigation - it's reachable
from the header's document icon (`ReportsButton`, "Open reports") on every
screen, from a "Reports" entry in Settings (distinct from "Daily
reports"), and, on phones, from the More sheet.

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

### The global Pay action

Added with Pay & Services Phase 1 (see `docs/pay-and-services.md`). A
persistent primary action labelled **Pay**, present throughout the
authenticated app - **not** a sixth navigation destination and **not** a
member of `MOVABLE_NAV_KEYS`: it opens the Pay & Services launcher and
never navigates or executes anything.

- **Mobile / tablet (`< lg`)**: an elevated circular action **dead-centre**
  of the fixed 5-slot bottom bar (`Home · Transactions · [Pay] · Budgets ·
  More`), with a visible "Pay" text label (never icon-only), a >=44px
  target, safe-area-aware, and a restrained pressed state (no pulsing).
- **Desktop (`>= lg`)**: a labelled pill button in the header, immediately
  left of the Reports icon.

One component, both renderings (`components/pay/PayTrigger.tsx`); a single
owner of the launcher's open state (`components/pay/PayProvider.tsx`,
mounted once in `AppShell`), so there is never a second launcher instance
or a second piece of state. Visibility is server-authoritative: the root
layout computes `payEnabled` from `lib/pay/gate.ts` (env flag + optional
per-workspace allowlist) and threads it in; the action is also absent on
the unauthenticated pages the shell already hides its header/nav on.

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

The desktop header nav (and the mobile bottom nav it swaps with) switches
at the same `lg:` (1024px) breakpoint as this grid, not the smaller
`sm:` (640px) it used before - 5 full-text-label pills plus the logo and
header icons don't fit in the 640-1023px range (a real overflow bug
caught by `e2e/responsive-matrix.spec.ts`'s tablet-portrait/768px case
and fixed in `AppShell.tsx`).

`getCurrentBalance()` returns the balance alongside the `occurred_at` of
the transaction it came from - the Current Balance card shows this as an
unobtrusive "Updated <when>" line (master prompt §7/§11.4's data-
freshness ask). This balance is only ever as current as the most recent
transaction MoMo has reported, never a live account query - the label
makes that explicit rather than implying real-time accuracy. No manual
refresh affordance exists: there is no user-triggered sync mechanism to
invoke (ingestion is automatic, via forwarded SMS), so one would have no
real effect - master prompt §7 itself only asks for a refresh control
"if meaningful."

Budget-status and attention-items cards are both **omitted entirely**
(not rendered as an empty-state box) when there's nothing to show - a
quiet dashboard on a quiet day is the correct state, not a broken one.
Attention items currently cover uncategorized/needs-review transactions,
pending learned-categorization-rule suggestions, budget allocations in
`warning`/`critical` status, and stale ingestion connections - each
backed by an existing, already-reliable query (`getReviewQueueCount`,
`getLearnedPolicySuggestionCount`, the active budget's own alerts,
`getIngestionConnections`). The stale-connection check is deliberately
conservative: only an *active* connection that has *never* received
anything and was created more than 24 hours ago - never "no activity in
N days" for a connection that has worked before, which would false-
positive on a genuinely low-transaction-volume user (master prompt
§8.3's explicit "do not generate false urgency").

Duplicate/suspicious-transaction detection and failed-import tracking
are **not** implemented - there is no reliable signal for either yet.
Investigated and deliberately not built: `momo_messages` does have a
real `'failed'` `processing_status`, but that table has no workspace
scoping at all and grants `authenticated` zero access by design
(`service_role` only) - surfacing it here would mean new schema/RLS
work (workspace-scoping the table or building a new authorized
aggregate), not just a query, which is exactly the "invent new business
logic solely to populate this component" this section is meant to
avoid. `getAttentionItems` in `lib/queries.ts` has a documented seam for
adding either later, once/if that schema work happens for its own
reasons.

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
move.

**Responsive matrix and motion/contrast preferences**
(`web/e2e/responsive-matrix.spec.ts`, plus the equivalent pre-auth tests
appended to `unauthenticated.spec.ts`) automate master prompt §19's full
breakpoint list - 320/375/390/428 (mobile), tablet portrait (768) and
landscape (1024), laptop (1280), desktop (1440), and wide desktop
(1920) - asserting no horizontal overflow and that the shell's key
controls (Reports icon, profile menu, active nav item) stay reachable at
every one. Also emulates `prefers-reduced-motion: reduce` and
`forced-colors: active` and confirms the shell still renders with every
control's accessible name intact. `app/globals.css` now disables all
transitions/animations globally under `prefers-reduced-motion: reduce`
(near-zero duration, not literal 0s, so nothing waiting on
`transitionend` hangs) rather than requiring every individual
`transition-*` utility class to opt in one by one.

**Still not covered** by this task: a full manual screen-reader pass
(the automated axe/keyboard/breakpoint coverage above is necessary but
not sufficient - screen-reader phrasing and flow still want a real
listen-through), and real-device forced-colors/high-contrast visual
verification (the emulated Playwright checks confirm the shell doesn't
break and controls stay nameable, not that every color choice is
genuinely legible under an OS high-contrast theme).

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

## Personalization and settings - what's deliberately not built

Master prompt §12 is explicit: **"Do not add settings that have no
implemented effect."** Several personalization options it lists were
evaluated and deliberately not built, because building the *setting*
without the *effect* would violate that rule directly:

- **Theme (light/dark/system)** - this app has no dark palette at all
  today (`app/globals.css` defines exactly one set of color tokens). A
  toggle that doesn't actually change anything is worse than no toggle;
  building a real one means designing and contrast-checking a second
  full palette across every component, which is a real, separate design
  effort, not a settings-page addition.
- **Default currency, date format, budget period start day** -
  `profiles.preferred_currency`/`timezone`/`locale` columns already
  exist (Phase B), but nothing in this codebase currently *reads* them -
  every amount is hardcoded RWF-formatted (`lib/format.ts`), every
  budget's period is fixed at creation, not derived from a recurring
  "start day" preference. Exposing a settings form for columns nothing
  consults would be exactly the no-effect setting §12 prohibits. Real
  multi-currency/date-format support is a cross-cutting change to the
  formatting and budget-math layers, not a form.
- **Transaction density (compact/comfortable)** - the one item here that
  *could* have a clean, real, small effect (row padding/spacing in
  `TransactionItem`), but doing it properly means a consistent decision
  across both the dashboard preview and the full Transactions page, a
  new stored preference, and a settings control - a reasonably-scoped
  follow-up, not attempted in this pass given how much ground this task
  already covers.

None of these are silently dropped - they're evaluated and explicitly
deferred, with the reasoning above, rather than half-built.

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
