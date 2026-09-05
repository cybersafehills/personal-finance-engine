# ADR 0014: Financial intelligence calculation boundaries

- **Status:** Accepted, implemented behind `INTELLIGENCE_ENABLED` (PR1:
  cash-flow forecast, spending baseline, recurring detection surfaced)
- **Date:** 2026-09-05
- **Builds on:** the reporting engine (`report-math.ts`), the pure
  recurring detector (`recurring-payments.ts`), the AI-facts sanitiser
  (`ai/facts.ts`). Non-custodial boundary (ADR 0001) unchanged.
- **Context:** OneLedger's Release 6 goal is to turn a trustworthy ledger
  into useful decisions (assessment section 7, sections 44-48). The risk
  is fabricated or opaque "intelligence" - a black-box score, a forecast
  presented as certainty, or AI inventing financial facts.

## Decision

### 1. Deterministic-first, always explainable

Every insight is computed by pure, unit-tested functions from the user's
own RLS-scoped ledger. Each carries a machine-readable `basis` (the
inputs), a `period`, and a `method` string; the UI renders these behind a
"Why am I seeing this?" disclosure (`ds/WhyThisInsight`) on every insight.
No insight ships without one.

### 2. No invented scores

There is no single "financial health score". Insights are concrete
statements a user can verify against their own transactions: "spending is
X% above your recent pace", "N recurring payments detected", "projected
balance in 30 days".

### 3. Cash-flow forecast: known vs estimated, never merged

`intelligence/cash-flow-forecast.ts` keeps two paths separate at every
checkpoint:

- **Known / scheduled** = current verified balance + dated recurring
  inflows/outflows + known bill due dates.
- **Estimated** = known minus a flat daily discretionary rate from the
  last 90 days of non-recurring outflows.

The estimated path is labelled a projection with an explicit disclaimer
("not a guaranteed outcome"). A projected dip below zero is surfaced as a
soft warning, not an alarm.

### 4. Recurring detection stays a heuristic

`detectRecurringPatterns` (already pure and tested) requires a
(counterparty, category) pair to recur across at least 2 of the last 4
complete months with amounts within 15% of the median. One or two weak
signals never mark something recurring. The user can inspect why via the
disclosure.

### 5. AI may explain, never compute

An AI provider may only receive the **sanitised deterministic facts**
(`ai/facts.ts` - no counterparty names, ids, or raw text) and may only
produce prose that restates them. It never produces a number that becomes
the balance, forecast, reconciliation state, entitlement, or any
authoritative value. There is no conversational financial adviser.

### 6. Gated, and no decorative charts

Behind `INTELLIGENCE_ENABLED` (dark). The Home surface
(`IntelligenceCard`) is text + one soft warning band - no new charts
(assessment "what not to build": no dashboards full of decorative
charts).

## Consequences

- New pure modules: `intelligence/cash-flow-forecast.ts` (+ tests),
  `intelligence/insights.ts` (server assembler), `ds/WhyThisInsight.tsx`.
- The previously-unwired `recurring-payments.ts` is now consumed.
- `report-math.ts`'s simpler month-end spend forecast stays as-is for
  report commentary; the cash-flow forecast is the richer Home surface.

## Not yet done

- High-confidence anomaly detection (unusually large single transaction
  vs the counterparty's own history) as its own insight.
- Reconciliation insights.
- Feeding known bill due dates into the forecast's `scheduled` list when
  `BILLS_ENABLED` (today: recurring outflows only).
- Wiring the forecast's `projectedProjectedSpend` into `ai/facts.ts`
  commentary.
