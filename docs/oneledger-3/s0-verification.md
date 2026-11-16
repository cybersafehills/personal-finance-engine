# S0 — Verification of prior P0 findings (2026-11-15)

Read-only source verification. **No tests were executed** (migration tests need a Postgres harness; Deno suites not run in this slice) — "fixed in source" ≠ "verified in production".

| Finding (ONELEDGER_AUDIT.md) | Status in source | Evidence |
|---|---|---|
| F1 Unauthenticated `send-notifications` | **Fixed in code** | `index.ts` rejects non-POST (405) and requires `x-notification-cron-secret` ≥32 chars via `authorizeDrainRequest` (`lib.ts:23-36`); rows claimed with lease through `claim_notification_emails` RPC (token + 300s lease). `config.toml` still has `verify_jwt = false` — acceptable only because the secret check exists. Prod secret set? **UNKNOWN** (also dark unless `NOTIFICATION_EMAIL_ENABLED`). |
| F2 Global SMS dedupe across tenants | **Fixed in code** | Migration `20261009000000_tenant_scoped_ingestion_dedup.sql` drops global fingerprint/payload-hash/external-id uniqueness; replaces with per-connection / per-source / per-workspace unique indexes. `ingest-momo/index.ts:483-486, 640-645` look up by `ingestion_connection_id`. Two-tenant regression tests exist in `supabase/migrations/tests/run_migration_tests.sh:1464-1542`. Applied to prod? **UNKNOWN** (per project memory, migrations through 202612xx deployed, so very likely). |

## Residual issues found
- Legacy `momo_messages` rows with NULL `ingestion_connection_id` stay outside the new unique index (documented in migration); no dedupe protection for them — low impact, historical only.
- `verify_jwt = false` on drain functions relies entirely on the secret; recommend a secret-rotation note in `security.md`.

## Parser / enrichment findings (input to S4)
- `ingest-momo/parser.ts` handles types: send_money, money_received, merchant_payment, airtime (+ other). **No extraction of Cash Power token, kWh, or bundle details** (only a comment at `parser.ts:108`). Spec §7 enrichment is therefore net-new work, and tokens must be stored encrypted/redacted — `_shared/log.ts` already redacts "token" keys in logs.
- **No Airtel parser fixtures**: "airtel" appears only in `policy_engine_test.ts`; none in `parser_test.ts`/`fixtures.ts`. Airtel ingestion (spec §6) is not implemented for SMS.

## Feature-flag inventory (env, from source)
SPACES_*, INTELLIGENCE_*, FINANCIAL_STATEMENTS_ENABLED, MOBILE_API_ENABLED, BILLS_*, INTEGRATIONS_WORKSPACE_ALLOWLIST, SCAN_TO_PAY_ENABLED, PAY_SERVICES_WORKSPACE_ALLOWLIST, BALANCE_RECONCILIATION_ENABLED, SMS_RECONCILIATION_ENABLED, REPORT_GENERATION_ENABLED, REPORT_EMAIL_DELIVERY_ENABLED, EMAIL_STATEMENT_INGEST_ENABLED, PDF_STATEMENT_IMPORT_ENABLED, ENTITLEMENTS_*, EXPERIENCE_MODE_BUSINESS_*, ONBOARDING_*, ACCOUNT_DELETION_*. Pattern: boolean `*_ENABLED` + optional `*_WORKSPACE_ALLOWLIST`. New 3.0 flags should follow it (e.g. `INSIGHTS_CENTER_ENABLED`, `COUNTERPARTIES_ENABLED`, `PAYMENT_REQUESTS_ENABLED`).

## Implication for plan
P0 gate cleared at source level; proceed to S1 (contracts/docs). Add to backlog: Airtel parser fixtures (needs real anonymised Airtel SMS samples from the owner), Cash Power enrichment with redaction.
