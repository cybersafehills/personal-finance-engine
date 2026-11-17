# OneLedger 3.0 — Phase 0 Repository Audit

Date: 2026-11-15 · Branch: `claude/oneledger-implementation-77312d` (worktree) · Base commit: `f5d3654` · Remote: `cybersafehills/personal-finance-engine` · Working tree: clean at audit start.
Deploy target (from repo/CI files): web on Vercel (CLI deploy), Supabase migrations/functions via `.github/workflows/deploy-supabase.yml`, mobile via EAS (`mobile-build.yml`).

**Method and limits.** This is a targeted static inspection (directory survey, migration table inventory, schema reads, grep). It is NOT a line-by-line review; nothing was executed, no DB was queried, no CI was run. "Verified" below means "read in source". Items marked **UNKNOWN** need runtime or prod evidence. Line references are to files read in this session; the earlier `ONELEDGER_AUDIT.md` (2026-08-30) is dated and partly superseded.

**Headline finding.** The spec reads as a greenfield 5-workstream build, but the repo already contains most of the foundations (≈130 migrations, ≈190 tables, statements/reports engine, Spaces/household, reconciliation, payment intents, an Expo app). OneLedger 3.0 is therefore a **gap-closing programme on top of existing code**, not a rebuild. Creating the spec's conceptual tables blindly would duplicate existing ones.

## Evidence matrix

| # | Capability | Status | Evidence | Gap / defect | Proposed action | Regression risk |
|---|---|---|---|---|---|---|
| A1 | Money in/out/net, category totals, period compare, trends | **Existing (web)** | `web/lib/report-math.ts`, `statement-math.ts`, `report-period.ts`, `app/reports/*`, `app/reports/statements` | No single "Insights Center" route; mobile lacks it (tabs: index, transactions, inbox, more; screens: budgets, category…) | Build one shared calc module consumed by web, mobile API, statements, emails; add `/insights` | Med — parity with PDFs/emails |
| A2 | Internal transfers excluded from spend | **Partial** | `transfer_links` (out/in txn, status linked/dismissed, same-workspace FKs; migration 20260825…) | Link is manual/detected pair; need to confirm every aggregate honours it (**UNKNOWN**) | Fixture-test each aggregate path | High |
| A3 | Period boundaries / timezone | **Existing, Kigali-specific** | `web/lib/kigali-time.ts` (fixed-offset shortcut, self-documented as Kigali-only); `report-period.ts` | Not reusable for other zones. Cron jobs are `*/5`/`*/15` pollers (`supabase/scheduling/*.sql`); the historical "23:00 compute / 07:00 email" is NOT literal cron — `report-period.ts` notes local-midnight day end | Use per-user tz from profile; keep Kigali default | Med |
| A4 | Recurring payment detection | Existing | `web/lib/recurring-payments.ts` + test | Reliability thresholds undocumented | Document + fixtures | Low |
| A5 | Drill-down aggregate → transactions | **UNKNOWN** | `app/transactions` has search/filters (per memory) | Not verified per aggregate | Contract: every aggregate returns a filter descriptor | Low |
| B1 | Multiple accounts/wallets, ownership | **Existing** | `accounts`, `financial_sources`, `source_space_links`, `workspace_memberships` | Provider coverage: only MoMo ingestion confirmed in prior audit; Airtel/bank via statement import only (**UNKNOWN** now) | Parser fixtures for Airtel; confirm | Med |
| B2 | Balance provenance (confirmed/estimated/stale/unavailable) | **Partial / defect** | `transactions.balance_after_rwf` is source of truth; `balance_reconciliations` per-txn (unique transaction_id; statuses reconciled/mismatch/insufficient_data/pending_review); fn `reconcile-balances` | No account-level `balance_observation` with as-of/provenance; balance columns are `*_rwf` (RWF hard-coded in column names — conflicts with spec §2 "don't hardcode currency") | Additive `balance_observations` + derived-status view; do NOT rename legacy columns | **High** |
| B3 | User-initiated reconciliation + audit | **Partial** | `20261117…balance_reconciliation_access.sql`, `app/api/cron/run-balance-reconciliation`, `pay/reconciliation` | Manual "reconcile this account" flow not confirmed | Add | Med |
| B4 | Android SMS / iOS policy honesty | Existing | `android/` legacy, `oneledger-mobile/src/features/ios-shortcuts`, `pairing` | iOS uses Shortcut/pairing (permitted). Android SMS policy for Play listing **UNKNOWN** | Policy review before store release | Med |
| C1 | Counterparty identity layer | **MISSING** | Only `transactions.counterparty_name/_reference` (text, indexed), `merchant_rules`, `trusted_recipients` (phone/merchant/biller/meter), `suppliers`+`supplier_aliases` (bills), `directory_aliases` (USSD) | No scoped person/merchant entity, no merge/split, no per-counterparty history | New `counterparties` + identifiers (additive), backfill from `counterparty_name`; **reuse trusted_recipients as source of explicit user-confirmed identities** | Med |
| C2 | Token/kWh/airtime enrichment | **UNKNOWN** | Parser in `supabase/functions/_shared` not yet read | Need to verify what the parser extracts and how tokens are stored/redacted | Read parser; add gated, redacted fields | Med (sensitive) |
| D1 | Mobile app foundation | **Existing** | `oneledger-mobile` (Expo Router; tabs; features: auth, budgets, capture, categories, inbox, lock, notifications, pairing, privacy, push, review, transactions); bearer API `web/lib/mobile-api.ts`, `docs/mobile-api.md` | No Insights, wallet switcher, people/merchants, payment requests screens. Per memory: preview APK never run on a real phone; Apple fee unpaid (**release blocked**) | Add screens against versioned mobile API | Med |
| D2 | Secure storage / MFA / lock | Existing | `features/lock`, `app/mfa.tsx` | Device/session revocation **UNKNOWN** | Verify | Med |
| E1 | Payment requests (non-custodial) | **MISSING** | No `payment_request*` table/code (grep empty). Existing: `payment_intents/attempts/events`, `payment_templates`, `lib/qr.ts`, `app/pay/*` (outbound USSD/QR handoff) | Spec's inbound "request money" link is new; outbound pay stack exists | New `payment_requests` with opaque token, expiry, revoke, audit; flag-gated; never auto-"paid" | Low (additive) |
| E2 | Fee intelligence | **Existing, versioned** | `route_fees` (fee_type incl. unknown/varies, bps, min/max, `effective_from/to`, `source_url`) | No user-facing calculator/compare confirmed (**UNKNOWN**); split-to-avoid-limits must NOT be built | Calculator reading `route_fees`, estimates only | Low |
| E3 | Provider payment execution | Out of scope | Settlement deliberately not claimed (prior audit) | — | Stay gated (Stage 3) | — |
| E4 | Referrals | **MISSING / gated** | none | Requires business policy | Do not build | — |
| X1 | Tenant isolation & authz | Existing | RLS-first design; `docs/authorization-matrix.md`; workspace membership validated in `lib/queries.ts` | Prior P0s (global SMS fingerprint, unauthenticated `send-notifications`) — **fix status UNKNOWN**, re-verify | Verify before any new ingestion work | High |
| X2 | CI | Existing | `.github/workflows/ci.yml` (deno fmt/lint/check/test per function; web/mobile jobs not fully read) | OpenAPI/contract-test job **UNKNOWN**; no `docs/oneledger-3` contracts yet | Add contract tests | Low |
| X3 | Audit events | Partial | `space_audit_events`, `payment_audit_events`, `service_directory_audit_events` | No universal `audit_events`; counterparty merge/reconcile need one | Extend, don't replace | Low |

## Actual data flow (as read)

```
SMS/Shortcut/Email/Statement/Manual
  -> ingest-momo | capture | inbound-email | import RPC
  -> momo_messages (legacy) + raw_financial_events
  -> process-raw-events (parse/normalise/dedupe/policy)
  -> transactions (direction in|out|neutral, fee_rwf, balance_after_rwf, counterparty_name)
  -> transfer_links / splits / categories / budgets
  -> balance_reconciliations (per txn) <- reconcile-balances / cron
  -> report-math / statement-math -> reports, statements(+PDF), packs, emails, mobile API (/api/mobile)
```

## Risk register (top)
1. **Currency hard-coded in schema** (`*_rwf` columns) — any "currency-agnostic" change is a migration hazard; keep additive and defer.
2. **Prior P0s unverified** (global dedupe, unauthenticated email outbox) — re-check first; a second tenant could lose transactions.
3. **Aggregate parity** across web/PDF/email/mobile is only as strong as the shared calc layer — needs fixtures before adding surfaces.
4. **Counterparty merging** is a privacy-sensitive, cross-scope risk — must be strictly workspace-scoped and reversible.
5. **Release blockers outside code**: Apple fee, real-device test, Play listing SMS-policy review, approved brand assets.
6. Concurrent sessions share this repo (per memory) — migrations/timestamps may collide; check before adding.

## Not yet audited (explicit)
Parser/enrichment code, web/mobile CI jobs, test coverage numbers, prod DB state, feature-flag inventory, notification delivery, PDF/email regression suites, account-level balance UI.
