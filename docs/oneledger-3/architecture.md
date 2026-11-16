# OneLedger 3.0 — Architecture and domain invariants (S1)

Status: proposed, needs owner sign-off. Basis: audit.md + s0-verification.md. Extend the existing modular monolith (Next.js web + Supabase Postgres/RLS + Deno edge functions + Expo app). No new services.

## Principles
1. **Scope = workspace.** Every new table carries `workspace_id` and RLS via `is_workspace_member(workspace_id)` (existing helper) plus capability checks from `space_role_has_capability`. Client filters are never a control.
2. **Additive only.** New tables/columns/views; legacy `*_rwf` columns and `momo_messages` untouched. No renames, no destructive migrations.
3. **One calculation layer.** Insights math lives in one pure, import-free TS module (same pattern as `money.ts`, tested with Deno) used by web pages, `/api/mobile/*`, statements, emails.
4. **Flag-gated.** `INSIGHTS_CENTER_ENABLED`, `COUNTERPARTIES_ENABLED`, `PAYMENT_REQUESTS_ENABLED`, `BALANCE_PROVENANCE_ENABLED`, each with optional `*_WORKSPACE_ALLOWLIST`, matching existing pattern.
5. **Non-custodial.** OneLedger never holds or moves money; no payment status is set to paid from user assertion or link-open.

## Money and currency
- Amounts are integer minor units with explicit `currency char(3)`; RWF scale 0 (see `web/lib/money.ts`). No floats.
- Existing transaction columns stay `*_rwf`. New tables use `amount_minor bigint` + `currency`. A read-view `transactions_money_v` (S2) exposes `amount_minor/currency` over legacy columns so new code never reads `_rwf` directly; cross-currency aggregation is refused unless an FX rate with provenance + date is supplied (none exists today, so: per-currency totals only).
- Reporting timezone: profile timezone, default `Africa/Kigali`. `kigali-time.ts` fixed-offset shortcut must not be reused for other zones; S2 introduces an Intl-based period helper (as `report-period.ts` already does) and tests DST/traveller boundaries.

## Domain invariants (enforced by tests/constraints)
- I1 Σ(money in) − Σ(money out) = net, per currency, per scope, per period; fees counted once (fee is part of outflow, not a second transaction, unless the source emits a separate fee row — then linked via fee link and excluded from "spend" double count).
- I2 Linked internal transfers (`transfer_links.status='linked'`) are excluded from income/spend and shown as "Transfers".
- I3 Refund/reversal rows reduce the original category's spend and never count as income; status `failed`/`pending` excluded from totals, shown separately.
- I4 Cash withdrawal is its own category class ("Cash out"), not consumption.
- I5 Every aggregate returns a **drill-down filter descriptor** that reproduces exactly its contributing rows.
- I6 Re-running any projection/backfill yields identical output (idempotent).
- I7 A balance is never displayed as Confirmed without a provider-reported observation; Estimated requires a baseline + gap-free classified txns since; else Unavailable.
- I8 Counterparty merges are workspace-scoped, reversible, audited; never inferred across workspaces.

## Balance status semantics (spec §6)
| Status | Meaning | Rule |
|---|---|---|
| Confirmed | Provider-reported balance observed (e.g. `balance_after` in SMS/statement) | latest observation ≤ `STALE_AFTER` old and no later txns |
| Estimated | Baseline observation + later classified txns | gap/reversal/unknown flags downgrade to Stale |
| Stale | Last observation older than threshold or later gap detected | show as-of time |
| Unavailable | No baseline | show nothing numeric |
`STALE_AFTER` is a documented config (proposed 7 days; owner to confirm after baseline metrics).

## Pipeline (unchanged stages, new projections shown as ▶)
source → raw_financial_events → process-raw-events → transactions → transfer/split/category → ▶balance_observations → balance_reconciliations → ▶counterparties/identifiers (resolved post-canonical, idempotent) → ▶insights calc module → API/web/mobile/PDF/email.
`payment_requests` is a separate bounded context (no coupling to ingestion except optional later link to a matched incoming transaction, suggestion only).

## Boundaries / modules
- `web/lib/insights/` (pure): period, aggregate, categories, trends, counterparties-rollup, drilldown. No I/O.
- `web/lib/counterparties/`: normalise, resolve, merge/split (DB via RPC).
- `web/lib/payment-requests/`: token, validate, state machine.
- DB writes through `security definer` RPCs with explicit authz (existing pattern: confirm/dismiss category RPCs).
