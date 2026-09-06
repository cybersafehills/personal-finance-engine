# ADR 0017: "Activity" as the ledger read model, and no universal "+ Add"

- **Status:** Accepted (documentation + naming only; no schema, no new
  read model).
- **Date:** 2026-09-06
- **Closes:** audit gaps **G7** (universal `+ Add`) and **G12** (Activity
  read-model ADR). Master prompt §16, §31, §43, §74–§75.

## Context

The Release 2 nav re-cut (`web/lib/navigation.ts`) renamed the primary
destination over the transaction ledger from "Transactions" to
**"Activity"**, keeping the route at `/transactions` (and its deep links
`/transactions/[id]`, `/new`, `/review`, `/transfers`). The audit asked
for an ADR pinning down what "Activity" *is*, and separately whether a
global `+ Add` control (§31) should exist.

## Decision

### 1. "Activity" is a label over the existing ledger, not a new model

There is **no `activity` table, view, or aggregate**. "Activity" is the
customer-facing name for the workspace transaction ledger:

- **Rows:** `transactions` for the active workspace, RLS-scoped, excluding
  `dedupe_state = 'merged'` (evidence rows that never appear in a
  listing), newest first. `getTransactions()` / `getAccountTransactions()`
  are the readers; `TransactionList` / `TransactionItem` render them.
- **Scope:** whatever the active Space grants. In a household, per-source
  visibility (`can_view_source_in_source`, ADR 0005) already filters which
  rows a member sees — Activity inherits that, it does not re-implement it.
- **Sub-surfaces** keep their own routes and their own purpose:
  `/transactions/review` (the review queue), `/transactions/transfers`,
  `/transactions/new` (manual entry), `/inbox` (the actionable decision
  layer). Activity is the *browse* surface; the Inbox is the *act* surface.

If a genuine cross-entity feed (transactions + bills + payments +
member events in one stream) is ever wanted, that is a new ADR and a new
read model — explicitly out of scope here.

### 2. No universal "+ Add" control

§31 makes a global `+ Add` (Account / Transaction / Connection / Space /
Budget / Member / Import) **conditional on it not conflicting with the
existing interaction model**. It does conflict:

- The phone bottom bar is a fixed five slots with the **elevated Pay
  action dead-centre** (`navigation.ts` `PHONE_BAR_KEYS` + `AppShell`). A
  second centre-ish floating "+" competes with it for the primary thumb
  zone and muddies "the big button in the middle does the main thing".
- Every resource that can be created already has a clear, contextual
  entry point on its own surface: "Add account" on `/settings/accounts`,
  "Add a transaction" on `/transactions/new`, "Connect a device" on
  `/integrations/connections`, "Create a Space" in the Space switcher,
  "New budget" on `/budgets`, "Invite member" on `/settings/workspace`,
  "Import a statement" on `/settings/sources/import`.

So: **do not build a universal Add menu.** Keep creation contextual. If
usage data later shows people can't find how to add something, revisit
with a specific, measured gap rather than a catch-all control.

## Consequences

- Documentation only. `docs/` and help copy should use "Activity" for the
  browse surface and keep "Transactions" only where it means the literal
  `transactions` table.
- The country → currency / MoMo-provider recommendation helpers
  (`momoProvidersForCountry` etc., audit G11) exist for a contextual
  "Add account" form to consume; they are not a global control.
