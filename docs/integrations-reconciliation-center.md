# Reconciliation Center

_Phase 3, P3-PR1._ A single read-only surface at
`/integrations/reconciliation` that gathers every open "these two things
disagree, a human must decide" queue. It **resolves nothing itself** — each
row links to the screen that already owns that decision.

## What it aggregates

| Section | Source reader | Resolves on |
| --- | --- | --- |
| Balance drift | `balance_reconciliations` (`mismatch` / `pending_review`) | `/transactions/review` |
| Payment matches | `web/lib/pay/intents.ts` → `getReconciliationQueue` | `/pay/reconciliation` |
| Possible duplicates | `web/lib/queries.ts` → `getSpaceDuplicateReview` | `/transactions/review` |
| Sync conflicts | `web/lib/integrations/queries.ts` → `listOpenConflicts` | `/integrations/sync/conflicts` |

A section renders as **"Coming soon"** (not "all clear") when its data source
is unavailable:

- **Balance drift** reads `balance_reconciliations` (see the population job
  below). It is `available: false` only if the read itself fails — an empty
  result is a genuine "all clear".
- **Payment matches** follows `isPaymentIntentSurfaceEnabled`.
- **Sync conflicts** follows `isWorkbooksEnabled`.

## Balance-drift population job (P3-PR2)

`balance_reconciliations` has existed empty since Phase 3; P3-PR2 wires up a
writer.

- **Migration** `20261117000000_balance_reconciliation_access.sql` — adds an
  authenticated `SELECT` policy scoped through
  `account_id → accounts.workspace_id → is_workspace_member`. Writes stay
  service-role only.
- **Edge function** `supabase/functions/reconcile-balances/` — imports the
  canonical `_shared/accounting.ts` + `_shared/reconciliation.ts` (never
  reimplemented), runs `reconcileTransactions` per account with no opening
  checkpoint (it bootstraps from the first reported balance), and **upserts
  one row per checkpoint keyed by `transaction_id`** — idempotent re-runs.
  Pure glue in `reconcile.ts` is unit-tested (`tests/reconcile_test.ts`).
  Hard-404s unless the Edge secret `BALANCE_RECONCILIATION_ENABLED=enabled`
  is set; requires the service-role key as a bearer token.
- **Cron** `web/app/api/cron/run-balance-reconciliation/route.ts` —
  `isAuthorizedCronRequest` + `BALANCE_RECONCILIATION_ENABLED === "true"`;
  forwards an authenticated trigger to the function. **Not scheduler-wired**
  (like every other cron here) — schedule the function directly in the
  Supabase Dashboard (Edge Functions → Schedules) or via `pg_cron`.
  Committed code is not proof the sweep is running.

## Code

- `web/lib/integrations/reconciliation/summary.ts` — **pure**, unit-tested
  (`summary_test.ts`). `buildReconciliationSummary(inputs)` takes one
  `ReconSectionInput` snapshot per queue and returns a ranked
  `ReconciliationSummary` (severity → backlog size → oldest item → stable
  key). No Supabase, no clock.
- `web/lib/integrations/reconciliation/queries.ts` — **server-only**
  assembler. Calls the four existing RLS-scoped readers and feeds the pure
  engine. No writes.
- `web/app/integrations/reconciliation/{page,loading}.tsx` — the surface.

## Authorization & gating

- Flag: `INTEGRATIONS_RECONCILIATION_CENTER_ENABLED` (on unless exactly
  `"false"`; also requires `INTEGRATIONS_ENABLED` and the workspace
  allowlist). `web/lib/integrations/gate.ts:isReconciliationCenterEnabled`.
- Capability: viewing requires `integration.view` (enforced transitively by
  every underlying reader's own RLS — the Center adds no new table).

## Not yet

The operational-health snapshot does not yet carry balance-drift metrics —
that arrives with the P3-PR7 `get_operational_health_snapshot` extension.
