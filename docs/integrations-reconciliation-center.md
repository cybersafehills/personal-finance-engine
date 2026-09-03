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
is gated off or not yet populated:

- **Balance drift** is `available: false` until the P3-PR2 population job
  (`supabase/functions/reconcile-balances` + the
  `run-balance-reconciliation` cron) is shipped and activated — nothing
  writes `balance_reconciliations` before that.
- **Payment matches** follows `isPaymentIntentSurfaceEnabled`.
- **Sync conflicts** follows `isWorkbooksEnabled`.

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

## Not in this PR

Balance-drift data (P3-PR2). The Center already renders the section shell so
turning the job on is the only change needed to light it up.
