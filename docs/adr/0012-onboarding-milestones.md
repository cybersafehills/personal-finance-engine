# ADR 0012: Onboarding as a persisted milestone journey

- **Status:** Accepted, implemented behind `ONBOARDING_JOURNEY_ENABLED`
  (PR1: durable spine + intent step; PR2: dashboard checklist,
  first-transaction review card, first insight, `/get-started` journey view)
- **Date:** 2026-09-05
- **Builds on:** ADR 0011 (experience modes), the profile/preferences
  onboarding (`20261022000000`), device pairing v2 (ADR 0008), async
  capture (ADR 0009).
- **Context:** First-run today (`/get-started` + `deriveOnboardingState`)
  is a checklist computed entirely from live signals with no persisted
  state, no intent selection, no plain-language value promise, no safe
  synthetic connection test distinct from ledger data, and no "first
  useful insight" moment (assessment section 6.3, audit F8). It is the
  single biggest adoption blocker.

## Decision

### 1. Seven milestones, mostly derived

```text
intent_selected
  -> source_added
  -> device_paired
  -> connection_verified
  -> first_real_transaction
  -> first_review_completed
  -> first_insight_seen
```

`web/lib/onboarding-milestones.ts` (pure) turns a `MilestoneSignals`
struct into an ordered checklist with one "do this next" pointer. Steps
may complete out of order where safe (a manual first transaction before
any device is paired); `done` is per-signal and `nextStep` is just the
first gap.

### 2. Derive what can be observed; persist only what cannot

| Milestone | Source |
| --- | --- |
| `source_added` | `financial_sources` owned by the user |
| `device_paired` | active `ingestion_connections` (later: `device_credentials`) |
| `connection_verified` | `last_used_at` set - a synthetic `op:"test"` (capture handler, ADR 0009) or any authenticated delivery |
| `first_real_transaction` | a row in `transactions` |
| `intent_selected` | **persisted** - `profiles.onboarding_intent` |
| `first_review_completed` | **persisted** - `profiles.onboarding_first_review_at` |
| `first_insight_seen` | **persisted** - `profiles.onboarding_first_insight_at` |

Deriving the observable milestones makes them **idempotent and
device-independent**: a reinstall, a new phone, or cleared browser
storage never rewinds the journey. Only the three genuinely
un-observable facts are stored, on the existing `profiles` row
(`20261129000000`), each nullable ("not yet").

### 3. The synthetic connection test already exists

`capture` `op:"test"` (ADR 0009) authenticates the device credential and
proves connectivity/auth/routing **without creating a transaction or
touching balances/reports** - it only stamps `device_credentials.last_
used_at`. `connection_verified` reads that signal. No new mechanism.

### 4. Intent does not create a Space

`set_onboarding_intent('household'|'business')` records the choice and
nothing more (assessment section 25). The Personal Space already exists
from signup; collaborative setup is deferred to its own later milestone.
Intent feeds the experience mode (ADR 0011) - established users are
backfilled from their personal workspace's `kind` so nobody re-enters
first-run.

### 5. RPCs, idempotent and self-scoped

`set_onboarding_intent(text)` and `mark_onboarding_milestone(text)` are
`SECURITY DEFINER`, `auth.uid()`-scoped (no cross-user write),
authenticated-only, and `coalesce` every timestamp so a re-run never
moves a "first happened" time. `mark_onboarding_milestone` accepts only
`first_review` / `first_insight`; every other milestone is derived.

## Consequences

- Deploy-drift safe: `lib/onboarding/journey.ts` treats a missing
  persisted column as "not yet" and still renders from derived signals,
  so the web deploy can precede the migration.
- Dark by default (`ONBOARDING_JOURNEY_ENABLED`); `/onboarding/intent`
  redirects to `/get-started` while off.
- Migration-suite coverage: `20261129000000` schema, constraint,
  idempotency, derived-milestone rejection, cross-user isolation, and
  authenticated-only grants.

## Implemented in PR2

- `OnboardingJourneyCard` on Home + `/get-started` rendered as the ordered
  journey (customer language, no raw "create a connection" choices) when
  the flag is on.
- `FirstTransactionReviewCard` (assessment section 30): one review
  question on the most recent transaction; either answer calls
  `mark_onboarding_milestone('first_review')` (and "Looks right" also
  `confirm_transaction_category`).
- `FirstInsightCard` (section 31): one deterministic fact - the biggest
  spending category so far, from `getCategoryTotals()` - no invented
  "score". "Got it" calls `mark_onboarding_milestone('first_insight')`.
- Home shows exactly one first-run surface at a time, in journey order
  (review -> insight -> checklist), and none once complete or dismissed.

## Not yet done (polish, later)

- The value-promise / source-add steps as their own wizard screens inside
  onboarding chrome (today: value promise is on `/onboarding/intent`;
  source-add routes to `/settings/sources` from the checklist).
- Device pairing embedded in an onboarding route rather than the checklist
  linking to `/pair` with a return path.
