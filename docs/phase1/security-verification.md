# Security and Space verification

## Boundaries changed or reused

- Existing merged balance-observation source visibility and counterparty source-visibility migrations are reused. The migration harness exercises owner/member/viewer, shared/private/paused/removed relationships, guessed identifiers, correction and undo paths, and direct role execution. Existing two-tenant sweep covers 84 workspace tables and rejects 23 forged inserts.
- Active web financial reads and native direct/local queries now apply selected workspace scope. Selection is context, not authorization; session RLS and source checks remain independent. Query result segregation and worker identity guard against rapid Space/user switching.
- New snapshot and ID-validation RPCs are security invoker, authenticated only. The financial classification view is security invoker. Anonymous execution is explicitly denied and asserted.
- `require_sensitive_assurance` checks current authentication and verified enrolled MFA factors, requiring JWT AAL2 when enrolled. It is invoked at payment request creation/update helpers/linking and new wallet mutations. The payment linking boundary additionally checks source visibility before disclosing transaction eligibility. Existing operation signatures remain.
- Wallet creation requires owner membership in Personal/organization Spaces and atomically creates a financial source plus account. Household source sharing remains the existing explicit workflow. Default selection is an owner/source-authorized RPC serialized by a workspace advisory transaction lock.

## Direct SQL evidence

The disposable PostgreSQL 17 suite passes 996 assertions, applies the entire chain reproducibly, checks authenticated/anonymous privileges, and tests new enrolled AAL1 rejection/AAL2 success, snapshot envelope, foreign-ID visibility, owner wallet creation/default, exactly one default and foreign mutation denial. These are real PostgreSQL role/RLS checks with test JWT claims, not real signed bearer HTTP calls.

The default-wallet and snapshot features require new migration 07. Counterparty repair migration 06 reuses the pending self-kind correction without weakening source guards. The two historical files at migration version 20270104000000 remain explicitly allowlisted; no third collision is permitted. Hosted migration ledger repair must be reviewed separately before CLI deployment; do not rewrite applied history blindly.

## Read-only hosted evidence, 2026-11-19

Supabase project `zttxsaiywkfrbdxgzbjd` was active/healthy, PG17.6.1.155. Applied ledger ended at 20270104000000 `balance_observations_source_visibility`; 05 counterparty privacy, 06 repair and 07 new contracts were not recorded. Local merged code is not evidence those security changes are deployed.

Visible active Edge revisions: inbound-email 36; reconcile-balances 36; process-raw-events 45; send-notifications 45; send-push-notifications 30; capture 49; ingest-momo 75. Nine scheduler jobs were active (bill monitoring/processing, payment expiry/reconciliation, raw-events, report generation/delivery, statement jobs/schedules). Last-24-hour query returned 3,264 succeeded cron executions. This establishes scheduler execution only, not successful downstream HTTP delivery. No cron commands, credentials or financial records are included here.

Vercel project searches for personal-finance/oneledger returned no visible project in the connected scope. Web deployment SHA, live flags and actual installed mobile build IDs remain unknown. Repository release configuration is Android versionCode 10, iOS buildNumber 1, app version 2.0.0; those are source settings, not release evidence.

Hosted security advisors reported 26 mutable function search paths, pg_net in public, disabled leaked-password protection, 21 RLS-with-no-policy informational findings and execution-surface warnings. The two anonymous definers are token-based invite/payment resolvers; exposure alone does not establish a vulnerability. No hosted changes were made. Review [search-path remediation](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable), [public extensions](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public), [RPC exposure](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [authenticated RPC exposure](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [RLS policies](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) and [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) as a separate deployment-hardening review.

## Release gates

Real bearer-only endpoints, cookie/bearer differences, expired signed sessions, complete role/source HTTP journeys and browser Space-switch E2E were not executed: Docker daemon/local Supabase unavailable. The historical SDK identity allegation was not used to rewrite working bearer authentication. New `web/e2e/space-scoping.spec.ts` is reused from PR285 but its presence is not execution evidence. SQL and mocked transport tests cannot replace these checks.
