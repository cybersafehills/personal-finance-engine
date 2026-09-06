# Onboarding funnel analytics

- **Status:** implemented (branch `feat/onboarding-analytics-review`).
- **Master prompt:** sections 54-55.
- **Module:** `web/lib/onboarding/analytics.ts` (+ `analytics_test.ts`).
- **Related:** ADR 0012 (onboarding milestones), `web/lib/spaces/analytics.ts`
  (same no-sink, redact-first pattern).

## Design

There is **no analytics provider wired into this codebase**. This module is
the single attach point a sink would use, and it sanitises every event
*before* it could leave the process, so the redaction stays unit-testable
whether or not a sink is connected. `trackOnboardingEvent` never throws and
never blocks the user action that triggered it.

`sanitizeOnboardingEventProps` allows through only: booleans, small rounded
counts (capped at 100 000), the intent enum (`personal|household|business`),
the seven milestone keys, and short identifier-free strings. It drops any
key matching `id`/`_id`/`uuid`/`token`/`name`/`email`/`phone`/`account`/
`amount`/`balance`/`counterparty`/`reference`/`note`, and any value shaped
like a UUID, a 6+ digit run, an email, or a URL.

## Events

| Event | Props | Wired at | Fires |
| --- | --- | --- | --- |
| `onboarding_started` | — | `completeProfileOnboarding` action | identity setup done, product setup begins |
| `profile_completed` | — | `saveProfileOnboarding` action | name/country/language saved |
| `preferences_completed` | — | `saveFinancialPreferences` action | currency/timezone saved |
| `intent_selected` | `intent` | `setOnboardingIntent` action | Personal/Household/Business chosen |
| `first_review_completed` | — | `markOnboardingMilestone("first_review")` | first transaction reviewed |
| `first_insight_seen` | — | `markOnboardingMilestone("first_insight")` | first insight shown |
| `setup_review_viewed` | `doneCount`, `complete` | `/onboarding/review` render | the setup review screen is opened |
| `onboarding_dismissed` | — | `dismissOnboardingChecklist` action | user dismisses the checklist |
| `onboarding_step_completed` | `step` | *(not auto-wired — see below)* | a milestone flipped `done` |
| `onboarding_completed` | — | *(not auto-wired — see below)* | every milestone met |

### The two derived events

`onboarding_step_completed` / `onboarding_completed` cover milestones that
are **derived from live data** (`source_added`, `device_paired`,
`connection_verified`, `first_real_transaction`) rather than marked by a
user action. Emitting them correctly needs the *previous* journey to diff
against, which nothing persists today. `journeyCompletionEvents(prev, next)`
(pure, tested) produces exactly the ordered event list for a `prev -> next`
transition — a stateful caller (a sink that snapshots the journey per user,
or a reconciler cron) feeds its output straight to `trackOnboardingEvent`.
Until such a caller exists these two events are defined but not emitted.

## Activation milestones (section 55)

- **First value:** `intent_selected` + `source_added` — the user has said how
  they'll use OneLedger and named where activity comes from.
- **Stronger:** `first_real_transaction` (derived milestone) — a real
  transaction has reached the ledger through a connection or import.

Both are milestone keys in `ONBOARDING_MILESTONES`; a connected sink reads
them off `journeyCompletionEvents`.
