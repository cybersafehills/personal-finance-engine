# OneLedger 3.0 — Execution Plan (DRAFT for owner approval)

> **Status (2026-11-17):** historical Phase 0 record, restored from the closed #195 branch. Slices S0–S6 and E1–E8 below have all shipped (see the per-slice notes in this folder); the build followed the recommended options at the end (recorded in #228). Open: web Wallets/People pages, fee calculator.

Principle: extend existing modules; every step additive, flag-gated, small PR. No prod migrations/deploys without explicit approval. Estimates intentionally omitted until the owner confirms priority and capacity (spec §13).

## Dependency map
```
P0 verify prior P0 fixes (dedupe scope, send-notifications auth)
 └─ P1 contracts freeze (docs/oneledger-3/contracts.md + OpenAPI for /api/mobile additions)
     ├─ A  Insights calc layer (shared module + fixtures)  ─► Insights web page ─► mobile Insights
     ├─ B  balance_observations + status view ─► wallet switcher (web/mobile) ─► manual reconcile
     ├─ C  counterparties (+backfill) ─► directory/detail ─► merge/split w/ audit ─► enrichment (needs parser read)
     └─ E  payment_requests (flagged) ─► share link/QR ─► fee calculator (reads route_fees)
Mobile screens depend on frozen contracts + A/B/C/E APIs.   Referrals/Stage 3 payments: NOT PLANNED (gated).
```

## Proposed slices (each = 1 PR, flag-gated)
1. **S0 Verification**: confirm/regress-test global-dedupe + outbox auth; read parser; inventory flags/CI. (read-only + tests)
2. **S1 Contracts/docs**: architecture, contracts, migration, security, test-plan, release-checklist.
3. **S2 Insights core**: pure TS calc module (integer money, transfer exclusion, refund/fee rules) + exact-total fixtures + parity tests against statement-math.
4. **S3 Balance provenance**: additive `balance_observations`; Confirmed/Estimated/Stale/Unavailable derivation; migration rehearsed on anonymised data.
5. **S4 Counterparties**: additive tables + idempotent backfill from `transactions.counterparty_name`; RLS tests (two-tenant).
6. **S5 Payment requests (Stage 1)**: table, opaque token, expiry/revoke/audit, public resolve minimal-fields endpoint; no "paid" automation.
7. **S6 Mobile screens**: Insights, wallet switcher, people/merchants, payment request share — after S2–S5 APIs.

## Decisions needed from the owner
1. Start order (recommended: S0 → S1 → S2, as correctness precedes surface area).
2. Confirm scope exclusions: no referrals, no Stage 2/3 payments, no auto-splitting for limit avoidance.
3. Permission to rehearse migrations only on a Supabase branch/local DB, never prod.
