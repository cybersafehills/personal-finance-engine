# OneLedger engineering and product handoff for Claude Code

**Prepared:** 2026-09-01  
**Repository:** `personal-finance-engine`  
**Current working branch:** `codex/canonical-shared-visibility`  
**Current HEAD:** `4736149` (`test: align auth journeys with hardened signup`)  
**Remote main observed at handoff:** `origin/main` at `fc1600b` (`feat: gate canonical connections read cutover (#80)`)  
**Audience:** Claude Code, taking over implementation, release, and productization work  
**Purpose:** Preserve the product intent, architectural constraints, completed work, branch/deployment state, verification practices, remaining risks, and the shortest credible path from a broad beta to a profitable product.

> Read this document before making changes. Then read `web/AGENTS.md`, the relevant ADR, and the domain document for the feature being changed. Do not infer production deployment merely from a local migration or commit. Do not print or copy secrets from ignored environment files.

## 1. Immediate takeover checklist

1. Run `git status --short --branch`, `git log --oneline --decorate -15`, and `git fetch --prune` before branching. The repository was clean when this handoff was prepared, but the current branch was five commits ahead of the last locally observed `origin/main`.
2. Review and release the five current-branch commits listed in section 3. They contain registration/auth hardening, an operator health endpoint, and the Financial Inbox.
3. Verify CI before merge: Deno quality/tests, migration-chain tests, and disposable-Supabase Playwright tests.
4. Confirm whether the Supabase migration `20261025000000_operational_health_snapshot.sql` has been deployed before calling the health route in production.
5. Confirm Vercel/Edge environment gates before enabling any feature. Many surfaces intentionally ship dark or allowlisted.
6. Do not skip the connector observation gates. The canonical connector architecture is deliberately staged and reversible.
7. Use `ONELEDGER_AUDIT.md` as the original evidence-based audit, but treat this handoff as the newer implementation-status overlay.

## 2. Product thesis and commercial direction

OneLedger should not be positioned as another budgeting dashboard or as an “MTN MoMo SMS tracker.” Its defensible wedge is:

> **Aggregate fragmented financial activity from Mobile Money, banks, statements, and assisted inputs; normalize it into a trustworthy ledger; then turn unresolved financial events into clear actions, collaborative workflows, and explainable intelligence.**

The near-term customer promise should be concrete: “Connect your financial activity once and know what happened, what needs attention, and what you can safely do next.”

The strongest initial market is Rwanda and similar fragmented financial ecosystems where Mobile Money, bank USSD, SMS alerts, CSV statements, cash, and informal business processes coexist. The product can later expand geographically by adding provider adapters without rewriting ledger, review, reporting, or collaboration domains.

The best monetization sequence is:

| Tier | Customer | Value boundary |
| --- | --- | --- |
| Free | Individual trying the product | One personal workspace, manual entry/import, one connected source, basic categorization and monthly overview |
| Personal Plus | Financially active individual/freelancer | Multiple automated sources, rules, scheduled reports, deeper trends, longer history, export |
| Household | Couples/families | Shared Space, explicit source sharing, multiple members, shared budgets/goals, action inbox |
| Business | Freelancer/SME/association | Multiple accounts/connectors, finance roles, approvals, invoice/receipt workflows, audit trail, professional reports |
| Enterprise later | Regulated/larger organization | SSO, policy administration, API/webhooks, advanced audit/export and support—only after demand is proven |

Charge for automation volume, collaboration, controls, reporting, and operational convenience. Do not paywall data export, deletion, baseline security, or the customer’s access to their own financial history.

## 3. Exact source-control state at handoff

### 3.1 Work merged through the locally observed `origin/main`

`origin/main` includes work through PR #80 and commit `fc1600b`, including:

- the application shell, PWA opening experience, mobile/desktop navigation, privacy mode, attention cards, responsive and visual test infrastructure;
- the accounting foundation, transaction semantics, reconciliation primitives, balances, transfers, splits, reversals, categorization policies, learned suggestions, budgets, goals, reports, AI commentary, and email/report scheduling foundations;
- Pay & Services: verified USSD directory, assisted payment intents, eKash route directory, QR scan classification and safe external handoff, SMS reconciliation and lifecycle surfaces;
- OneLedger Spaces: Household workspaces, explicit source sharing, member attribution, shared goals/budgets, notifications, duplicate review, statement import, audit/analytics/monitoring, and production gates;
- onboarding improvements through persisted profile/preferences, resumable get-started checklist, Shortcut instructions, readiness checks, connection setup, invite polish, and email deliverability logging;
- security and trust-boundary hardening, tenant-scoped ingestion deduplication, authenticated/idempotent notification delivery, internal redirect protection, password/MFA foundations, and provider-neutral connector modeling;
- canonical connector Stages A–D preparation, dual-write/shadow health, credential history, lifecycle controls, multi-source routing, MTN adapter/canary pairing, installation-level rollout controls, and the guarded canonical Connections read cutover.

### 3.2 Current branch commits not in the locally observed `origin/main`

The current branch is clean and contains these five commits beyond `origin/main`:

| Commit | Work | Release significance |
| --- | --- | --- |
| `3533542` | Harden registration and operational health | Password policy alignment, safer signup/verification behavior, aggregate service health model and tests |
| `8bb18e8` | Expose secret-gated health endpoint | Operator-only `/api/admin/operational-health` route using the cron secret |
| `9ccd206` | Classify rejected Resend credentials | Improves email-health diagnosis rather than collapsing credential failures into a generic state |
| `2932b27` | Add prioritized Financial Inbox | Read-only unified queue across existing review/action systems; adds `/inbox` and shell entry points |
| `4736149` | Align auth journeys with hardened signup | Updates end-to-end flows to follow the new signup/verification contract |

Diff from the last observed `origin/main`: 34 files, approximately 1,704 insertions and 70 deletions. Review `git diff --stat origin/main...HEAD` and the individual commits before merging. This handoff does not claim that these commits are merged, deployed, or live.

### 3.3 Release discipline

- Prefer a small PR from the existing branch after rebasing/merging the latest main safely.
- Do not rewrite or squash away migration history after a migration may have reached production.
- GitHub CI is the authoritative merge gate. Deployment state is separate from merge state.
- `.github/workflows/deploy-supabase.yml` applies migrations and deploys Edge Functions after CI/release conditions. Verify the actual run rather than assuming it fired.
- Vercel deploys the `web` application separately. A successful web deployment does not prove migrations or Edge Functions are current.

## 4. Architecture at a glance

```text
Next.js 16 web/PWA (React 19, TypeScript, server components/actions/routes)
        |
        | session-bound Supabase client; user identity verified server-side
        v
Supabase Auth -> profiles -> workspaces -> memberships/capabilities
        |
financial_sources -> source_space_links -> accounts
        |
connector_installations -> device_credentials
        |
SMS/Shortcut, statement, future API/email adapters
        v
raw_financial_events -> parser/normalizer -> dedupe/review
        v
transactions -> accounting effects -> balances/budgets/reports/alerts

Pay UI -> verified USSD/QR/provider handoff -> payment intents/events
       -> later deterministic reconciliation to an existing ledger transaction

Cron/Edge jobs -> reports, delivery, expiry, reconciliation,
                  directory verification, notification delivery
```

Keep this as a modular monolith. The repository does not need microservices, Kafka, or a generic workflow engine. Stable domain boundaries and better module decomposition are valuable; distributed infrastructure is not yet the bottleneck.

## 5. Non-negotiable domain and security invariants

1. **OneLedger is non-custodial.** It may prepare, explain, and hand off a payment action. It must never imply that a handoff equals settlement. See ADR 0001.
2. **Financial amounts use integer minor units and explicit currency.** Avoid floating-point money. `amount_rwf` is legacy/provider-shaped; the canonical direction is amount minor units plus currency.
3. **RLS/RPC authorization is the tenant boundary.** Middleware improves UX but is not sufficient authorization.
4. **Service-role code must resolve explicit tenant/source/account scope.** It bypasses RLS and therefore needs narrower, tested queries—not broad fallbacks.
5. **Source visibility is explicit.** Household membership never automatically exposes a person-owned financial source. See ADR 0005.
6. **Attribution is recorded, not inferred.** Who owns a source, who performed a transaction, and which Space can see it are different concepts.
7. **Raw evidence is preserved and protected.** Parsers can improve; evidence must remain reprocessable, but routine logs must not contain raw financial text or secrets.
8. **Deduplication is source/tenant scoped.** Identical financial messages belonging to different customers must coexist.
9. **Ambiguous records go to review.** Never silently auto-merge duplicate candidates or guess an account/Space route.
10. **Credentials are reveal-once, hashed, scoped, rotatable, revocable, and auditable.** Rotation creates history; it does not overwrite provenance.
11. **A connector installation, financial source, account, and device credential are distinct lifecycles.** Do not collapse them back into one table or UI object.
12. **External QR/provider links are untrusted data.** Use the classify -> validate -> resolve -> allowlist pipeline in ADR 0006.
13. **AI explains deterministic facts.** It must not invent balances, silently post uncertain entries, or become the sole accounting decision maker.

## 6. What was built, by product domain

### 6.1 Identity, authentication, and onboarding

Implemented:

- email/password signup, confirmation callback, login, reset password, session refresh and protected routes;
- automatic profile, personal workspace, and owner membership provisioning;
- login lockout and safer generic authentication errors;
- MFA/TOTP foundation and MFA route/surface;
- internal redirect normalization to avoid untrusted redirect targets;
- server-side registration validation and a backend-aligned password policy;
- explicit pending-email-verification state, resend verification action, and improved Resend error classification;
- resumable onboarding across profile and preferences pages;
- persisted profile preferences/onboarding migration (`20261022000000_profile_preferences_onboarding.sql`);
- guided `/get-started` checklist derived from real milestones, with default/allowlist gates;
- email confirmation tests that proceed into profile onboarding;
- Shortcut setup guide, connection readiness probe, and setup progress;
- household invite resend/expiry/inviter context and invitee-scoped onboarding.

Important status:

- The newest signup/verification hardening is on the current branch, not the last observed main.
- MFA exists but must still be assessed as a complete customer journey: enrollment, recovery guidance, factor management, reauthentication/step-up, and lost-device handling.
- The product still needs an explicit user-facing data export/deletion/retention workflow.

Key files:

- `web/app/signup`, `web/app/login`, `web/app/verify-email`, `web/app/auth`, `web/app/get-started`
- `web/app/onboarding/profile`, `web/app/onboarding/preferences`
- `web/lib/registration.ts`, `web/lib/auth-callback.ts`, `web/lib/profile-onboarding.ts`, `web/lib/onboarding.ts`
- `web/proxy.ts`
- `docs/onboarding-and-connections-design.md`, `docs/email-deliverability.md`

### 6.2 Application shell, responsive UI, and PWA

Implemented:

- unified desktop navigation and five-slot mobile bottom navigation with Pay centered;
- responsive dashboard including two-column desktop layout and full-width fallback;
- privacy/balance-hiding controls, fresh/stale balance indicators, budget and attention cards;
- branded startup sequence for web, iOS PWA, slow loads, and reduced-motion users;
- iOS launch assets and metadata fixes;
- mobile form focus/zoom and edge-crop fixes;
- route loading/error states, root error boundary, keyboard/focus improvements, Escape handling;
- visual regression baselines, accessibility checks, responsive matrix, forced-colors and reduced-motion coverage.

Remaining:

- Expand CI/device coverage beyond the current main Chromium desktop gate, especially WebKit/iPhone signup, pairing, scanning, and form behavior.
- Continue replacing technical/internal vocabulary with customer language.
- Break large interactive components into testable domain pieces.

Key files/docs: `web/components/AppShell.tsx`, `web/app/globals.css`, `web/e2e`, `docs/application-shell.md`, `docs/app-shell-rollout-runbook.md`, `docs/brand-opening-screen.md`.

### 6.3 Ledger, transactions, accounting, and reconciliation

Implemented:

- canonical accounting fields and integer-money helpers;
- accounts and financial sources, balances, accounting effects and reconciliation foundations;
- manual transactions, splits, transfers, reversals/corrections, transfer detection;
- raw financial event provenance and parser-version concepts;
- tenant/source-scoped ingestion deduplication and conservative duplicate review/dismiss/merge trails;
- transaction review, categorization decisions, learned suggestions, and audit history;
- payment reconciliation that links a payment intent to an existing transaction rather than creating settlement evidence;
- backfill planning, dry-run implementation, isolated tests, and readiness/rollback documentation.

Do not run the Phase 4.1 production backfill casually. Read `supabase/migrations/PHASE_4_1_BACKFILL_READINESS_REPORT.md`; it documents eligibility, compare-and-set behavior, backup and rollback. The report explicitly says the production write was not executed at the time it was prepared.

Key files/docs:

- `supabase/functions/_shared/accounting.ts`, `money.ts`, `reconciliation.ts`, `payment-reconciliation.ts`
- `supabase/functions/ingest-momo`
- `web/app/transactions`, `web/lib/transfer-detection.ts`, `web/lib/statement-import.ts`
- `supabase/migrations/PHASE_3_MIGRATION_REPORT.md`, `PHASE_4_1_BACKFILL_READINESS_REPORT.md`
- ADR 0002 and ADR 0003

### 6.4 Categorization, budgets, goals, reports, and intelligence

Implemented:

- categorization policy templates, scoped rules, decision/conflict history, apply preview and learned suggestions;
- budgets, category budgets, goals, shared goals, variable-income and allocation math;
- budget threshold-crossing state and alert production;
- scheduled report definitions, deterministic snapshots, reporting periods, immutable artifacts and PDFs;
- optional Anthropic/OpenAI commentary that is validated against deterministic report facts;
- report email delivery, cron protection, idempotency/concurrency controls, kill switches and runbooks;
- household report source visibility and exclusion of merged duplicate rows.

Known limitations:

- Forecasting is not yet the product’s strongest differentiator; recurring obligations, cash-flow projection and explainable scenario planning remain opportunities.
- Reporting, notification and reconciliation schedulers require operational activation and heartbeat monitoring; committed code is not proof that each schedule is active.

Key files/docs: `web/app/categories`, `web/app/budgets`, `web/app/reports`, `web/lib/report-generation.ts`, `web/lib/report-delivery.ts`, `web/lib/ai`, `docs/categorization-engine.md`, `docs/reporting-engine.md`, `docs/reporting-verification-runbook.md`.

### 6.5 Pay & Services

Implemented:

- verified USSD service directory and admin publishing flows;
- Assisted Quick Pay drafts/intents, recipients/templates, intent lifecycle and session-freshness rules;
- SMS-to-intent deterministic reconciliation and review conflicts;
- payment-network schema, granular `directory.*` permissions, maker-checker concepts, sources/evidence and versions;
- eKash public network/route pages, bank-to-wallet route discovery, verified codes, favorites and suggestions;
- QR scanning camera shell, native/fallback decoding, payload classification, validation, review and external handoff;
- scan/payment analytics, monitoring, reconciliation, expiry and help/runbooks;
- iOS `jsQR` fallback so Scan to Pay does not depend only on `BarcodeDetector`.

Important guardrail: feature breadth exceeds verified provider coverage. Do not market every seeded or modeled payment route as live. Verification state and evidence must be visible, and real-device telephony handoff must be tested using `docs/pay-scan-verification-runbook.md`.

Key files/docs: `web/app/pay`, `web/lib/pay`, `web/lib/ussd`, `web/lib/directory`, `docs/pay-and-services.md`, `docs/pay-services-phase-p-design.md`, ADRs 0001–0004 and 0006.

### 6.6 OneLedger Spaces / Household collaboration

Implemented:

- Household as a workspace kind on the existing tenancy model;
- workspace switching and household creation;
- member invitations, owner/admin/member/viewer roles, additive capabilities and audit/activity primitives;
- person-owned financial sources with explicit per-Space visibility links;
- shared account UI, transaction provenance and member attribution;
- household dashboard, shared goals, categories and budget alerts;
- member administration and notification preferences;
- ingestion routing, duplicate review, connection lifecycle controls, statement imports and scoped categorization rules;
- in-app notification delivery spine and opt-in email outbox;
- analytics, structured error monitoring, removed-member notice, loading/help copy and production readiness checks;
- feature-flag and allowlist rollout controls.

Remaining product work:

- Complete recipient-bound/explicitly transferable invite semantics and re-check privileged invite redemption.
- Consolidate legacy role-tier authorization and newer named capabilities into a fully tested effective matrix.
- Validate Household willingness to pay before building arbitrary custom roles.
- Business workspaces, approval flows, invoice/expense operations, accountant access and billing are not complete products yet.

Key files/docs: `web/lib/spaces`, `web/components/spaces`, `web/app/settings/workspace`, `web/app/settings/sources`, `docs/oneledger-spaces-design.md`, `docs/spaces-production-readiness.md`, `docs/authorization-matrix.md`, ADR 0005.

### 6.7 Connections, ingestion, and provider-neutral adapters

The original one-row `ingestion_connections` model combined provider, account route, credential and lifecycle. It worked for one Shortcut feeding one MoMo account but could not represent a bank authorization discovering multiple accounts. ADR 0007 introduced four distinct domains:

```text
Connector installation
  1 -> many financial sources
  1 -> many device credentials

Financial source
  1 -> one or more workspace account projections

Device credential
  belongs to one installation
  optionally scopes to one account
```

Implemented staged work:

- **Stage A:** additive canonical tables/columns and relationship constraints;
- **Stage B:** deterministic preflight/backfill and repair for deployed data drift;
- **Stage C:** dual-write, canonical provenance, shadow resolution, mismatch fail-closed behavior, durable shadow-health telemetry;
- **Stage D preparation:** canonical read projection, default-off Connections preview, owner-scoped lifecycle RPCs, credential history/rotation, canonical auth resolver, multi-source discovery and deterministic route resolver;
- provider-neutral adapter boundary in `_shared/connector-adapter.ts`;
- concrete `mtn_momo_sms_v1` adapter and exact-match rollout gate;
- MTN installation canary pairing with platform-admin restriction, one-enabled-installation constraint and five-clean-match readiness threshold;
- installation-specific ingestion rollout control;
- guarded canonical Connections read cutover (PR #80), preserving a rollback path.

Do not remove legacy compatibility yet. Stage E—retiring `ingestion_connections`—is intentionally unbuilt and is irreversible without a tested restore. Before any broader cutover, require a representative observation window, every active connection seen, zero unexplained route mismatches/errors, exercised pause/rotate/revoke behavior, and successful rollback rehearsal.

The only confirmed end-to-end automated ingestion connector is MTN MoMo SMS/Shortcut. Airtel, bank APIs, email alerts, PDFs, receipts and native Android capture remain future adapters or partial schema concepts; do not claim them as shipped connectors.

Key files/docs:

- `docs/adr/0007-provider-neutral-connector-model.md`
- `docs/momo-ingest-contract.md`, `docs/momo-shortcut-setup.md`
- `supabase/functions/_shared/connector-adapter.ts`
- `supabase/functions/ingest-momo/adapter.ts`, `connection-resolver.ts`, `index.ts`
- migrations `20261011000000` through `20261024000000`
- `web/lib/connector-read-model.ts`, `web/lib/mtn-momo-pairing.ts`
- `web/app/settings/connections`

### 6.8 Notification delivery and email

The original audit identified a public, non-atomic `send-notifications` drainer. Subsequent work hardened the trust boundary with secret authentication, delivery claims/leases, retry/idempotency behavior, redacted logging, and tests. Email delivery remains intentionally opt-in.

Implemented:

- transactional email through Resend;
- redacted `email_send_log` audit trail and deployment-drift-tolerant migration;
- email health endpoint/rules;
- notification outbox and Edge Function delivery;
- delivery gating and claims to reduce duplicate sends;
- newest branch classifies rejected Resend credentials more precisely.

Before enabling email delivery, verify domain authentication, sender identity, rate limits, secret configuration, queue health and replay behavior using `docs/email-deliverability.md` and `docs/spaces-production-readiness.md`.

### 6.9 Financial Inbox

The current branch adds `/inbox`, a prioritized read-only projection over existing queues. It does not duplicate workflow state. Sources include:

- transaction categorization/conflict review;
- possible duplicate clusters;
- household attribution gaps;
- payment reconciliation conflicts;
- connector failures/staleness;
- other existing action-required states exposed by the projection.

Critical items sort ahead of high and normal items; oldest comes first within a priority. Every item links to the owning workflow, whose existing RLS and mutation rules remain authoritative. This is a strategically important product surface because it converts OneLedger’s broad feature set into one daily “what needs my attention?” loop.

Key files/docs: `web/app/inbox/page.tsx`, `web/lib/financial-inbox.ts`, `web/lib/financial-inbox-model.ts`, `docs/financial-inbox.md`.

### 6.10 Operational health

The current branch adds a service-only aggregate snapshot over ingestion, duplicate review, report jobs, email and payment reconciliation. It deliberately returns no customer identifiers, payloads, credentials, destinations, provider references or financial amounts.

- RPC: `get_operational_health_snapshot(window_minutes)` in migration `20261025000000_operational_health_snapshot.sql`.
- HTTP: `GET /api/admin/operational-health?window_minutes=60`.
- Auth: constant-time `X-Report-Cron-Secret` comparison.
- A critical result returns HTTP 503, suitable for an uptime monitor.
- “Insufficient data” is neutral, not proof of health; release gates still need representative traffic.

Initial beta thresholds and a curl example are documented in `docs/operational-health.md`. Add an external monitor and escalation ownership; an endpoint no one watches is not observability.

## 7. Database and migration posture

The repository currently contains 76 SQL migrations. Migrations are append-only historical records and encode extensive RLS, RPC, audit, dedupe, accounting, connector, directory, reporting and collaboration rules.

Rules for future work:

- Never edit an already deployed migration to “fix” production. Add a new forward migration that tolerates both fresh-chain and drifted production state.
- Run `supabase/migrations/tests/run_migration_tests.sh` against an ephemeral PostgreSQL instance.
- Include fresh-chain, relevant upgrade/drift, RLS, privilege and invariant assertions.
- Prefer database-enforced composite relationships and owner-scoped RPCs for financial invariants.
- Treat `service_role` grants as a security review item.
- Keep rollback/kill-switch behavior documented before feature enablement.

Historical incidents already handled include ownership-backfill ordering, missing function grants, deployed onboarding/email-log drift, and Stage-B canonical connector preflight repair. Preserve those self-healing behaviors.

## 8. Feature flags and operational controls

Inspect `web/.env.local.example`, the relevant gate module, Edge Function secrets, and the deployment environment. Flag conventions are not perfectly uniform: some features are on unless exactly `false`; sensitive rollouts are off unless exactly `true` or `enabled`.

Important gates include:

| Domain | Gate(s) | Expected posture |
| --- | --- | --- |
| Onboarding checklist | `ONBOARDING_CHECKLIST_ENABLED`, `ONBOARDING_CHECKLIST_WORKSPACE_ALLOWLIST` | Generally on unless disabled; allowlist for rollout |
| Spaces | `SPACES_ENABLED`, `SPACES_WORKSPACE_ALLOWLIST` | Opt-in and allowlisted during beta |
| Pay/USSD | `PAY_SERVICES_ENABLED`, `USSD_DIRECTORY_ENABLED`, `PAY_SERVICES_WORKSPACE_ALLOWLIST` | Layered gates |
| Assisted pay | `ASSISTED_PAY_ENABLED`, `PAYMENT_TEMPLATES_ENABLED`, `TRUSTED_RECIPIENTS_ENABLED` | Downstream of Pay gate |
| Networks/admin/suggestions | `PAYMENT_NETWORKS_ENABLED`, `DIRECTORY_ADMIN_ENABLED`, `DIRECTORY_SUGGESTIONS_ENABLED` | Suggestions are exact `true` opt-in |
| Scan to Pay | `SCAN_TO_PAY_ENABLED` | Exact `true` opt-in |
| SMS reconciliation | `SMS_RECONCILIATION_ENABLED`, `SMS_RECONCILIATION_MODE` | Start in `observe` |
| Reporting | `REPORT_GENERATION_ENABLED`, `REPORT_EMAIL_DELIVERY_ENABLED` | Kill switches; activation is operational |
| Notification email | `NOTIFICATION_EMAIL_ENABLED` plus Resend credentials | Dark unless exact `true` and configured |
| Canonical Connections UI | `ONELEDGER_CANONICAL_CONNECTIONS_UI=enabled` | Server-only, default off unless rollout approved |
| Canonical ingestion | `ONELEDGER_CANONICAL_INGESTION=enabled` | Default off; gated by evidence |
| Installation rollouts | `ONELEDGER_INSTALLATION_INGESTION_ROLLOUTS=enabled` | Enables exact installation-level rollout rows |
| MTN adapter | `ONELEDGER_MTN_MOMO_ADAPTER=enabled` | Requires adapter gate and canary readiness |

Never expose server-only rollout secrets through `NEXT_PUBLIC_*`. Do not “simplify” exact-match gates without reviewing their rollback semantics and tests.

## 9. Verification and development commands

From repository root unless noted:

```sh
# Repository state
git status --short --branch
git log --oneline --decorate -15
git diff --check

# Web lint/type/build
cd web
npm ci
npm run lint
npx tsc --noEmit
npx next build --webpack

# Pure library tests
deno test lib

# Edge/shared quality and tests (from repo root)
deno fmt --check supabase/functions supabase/migrations/tests
deno lint supabase/functions
deno check supabase/functions/ingest-momo/index.ts
deno check supabase/functions/send-notifications/index.ts
deno test supabase/functions/ingest-momo/tests
deno test supabase/functions/send-notifications/tests
deno test supabase/functions/_shared/tests

# Migration chain
supabase/migrations/tests/run_migration_tests.sh

# Browser tests use a disposable local Supabase stack; see CI and web/e2e/README.md
cd web
npx playwright test --project=unauthenticated --project=chromium-desktop
```

Notes:

- `next build` with Turbopack has previously failed locally because of an internal port/sandbox restriction. `npx next build --webpack` successfully exercised the production graph in recent connector work.
- CI pins Deno, Supabase CLI and browser dependencies. Match CI versions when investigating drift.
- E2E tests require local Supabase environment values and test users; do not point destructive tests at production. The CI workflow deliberately uses a disposable stack.
- The full pure `web/lib` suite recently passed with 383 tests during connector work; the number will grow. Do not hard-code it as a permanent expectation.
- The current repository scan found 64 unit/E2E test files, 73 application pages and 76 SQL migrations. These are orientation counts, not coverage claims.

## 10. Known risks and unfinished work

### P0/P1 trust and reliability

- Release and deploy the current auth/health/inbox branch with full CI and migration verification.
- Re-run a two-tenant regression audit for ingestion evidence, raw-event uniqueness, source visibility and service-role queries after every ingestion change.
- Complete privileged invite recipient semantics and tests.
- Complete MFA recovery/factor-management/step-up flows for credential rotation, membership administration and sensitive payment actions.
- Implement user data export, deletion and retention controls; document raw SMS/event retention.
- Connect operational health to an actual uptime/alerting service and define who responds.
- Audit scheduler activation/heartbeats for reports, payment expiry/reconciliation, directory verification and notifications.

### Connector rollout

- Observe canonical shadow resolution on representative production traffic.
- Ensure every active connection has been exercised; investigate every mismatch/error.
- Exercise pause, resume, rename, rotate and revoke in real conditions.
- Keep canonical UI and ingestion gates reversible until exit criteria pass.
- Do not start Stage E retirement until compatibility readers are proven absent and restore is rehearsed.
- Build a customer-friendly one-time pairing flow/QR/prebuilt Shortcut so setup no longer exposes endpoint/header/JSON mechanics.
- Add bank/email/Android adapters one at a time behind the provider-neutral contract; start with a design-partner use case rather than a broad connector catalog.

### Product/UX

- Make the Financial Inbox the primary daily loop; measure time-to-resolution and recurring unresolved categories.
- Reduce navigation/feature overload. Hide admin/experimental depth from ordinary personal users.
- Finish the first-value journey: signup -> verify -> profile/preferences -> connect/import -> first event -> one review -> one useful insight.
- Add WebKit/iPhone tests for signup, verification, pairing, scanning and 16px form controls.
- Establish a consistent customer vocabulary: source, account, connected device, Household/Space, workspace, and connection status.
- Self-host fonts and set the Next/Turbopack root if not already resolved; avoid build dependence on external font downloads.

### Maintainability/performance

- Split oversized modules (`web/lib/queries.ts`, ingestion orchestration, report generation, scanner/payment components) along the domain boundaries in section 4.
- Add lint and production-build jobs explicitly if the current CI still omits them.
- Batch service-role reconciliation where safe; avoid one RPC per intent.
- Add query/bundle telemetry before introducing caches.
- Keep structured logs redacted and correlated; do not emit raw SMS, tokens, provider references or full customer destinations.

### Commercial gaps

- No subscription, entitlement, plan-limit, billing or dunning domain is implemented.
- Business workspaces, invoices/accounts receivable, expense approvals, accountant workflows and tax-ready exports are not complete end-to-end products.
- No native Android SMS companion exists; no native iOS app/App Intent distribution exists.
- Airtel/bank/email/PDF/receipt ingestion should be considered planned/partial until a real adapter, fixtures, monitoring, onboarding and production verification all exist.

## 11. Recommended execution roadmap to profitability

### Phase A — ship a trustworthy private beta (next 2–4 weeks)

Goal: 10–20 design partners can onboard and reliably keep one real source synchronized.

1. Merge/deploy current auth, health and Inbox work.
2. Install uptime checks against operational health and all critical schedulers.
3. Finish one-time MTN Shortcut pairing and connection-health UX.
4. Complete iPhone/WebKit end-to-end verification on real devices.
5. Recruit Rwanda-based individuals/freelancers already using MTN MoMo heavily.
6. Instrument activation: signup verified, profile completed, source connected, first event received, first Inbox item resolved, day-7 return.

Success criteria:

- at least 70% of invited users reach first synchronized event;
- median time to first value under 10 minutes for supported setup;
- ingestion success above the documented SLO with no unresolved cross-tenant/security incidents;
- at least 40% week-4 retention among activated design partners;
- users can explain the Inbox’s value without founder guidance.

### Phase B — validate willingness to pay (following 4–8 weeks)

Goal: convert the strongest personal/freelancer use case into paid Personal Plus.

1. Add entitlements and billing only after beta activation is healthy.
2. Package multiple connections, automatic rules, scheduled reports and longer history/export as paid convenience.
3. Add one additional ingestion path selected from real demand—likely CSV/bank statement polish or a specific bank SMS/email adapter.
4. Improve recurring cash-flow and obligation insights using deterministic evidence.
5. Add in-product upgrade prompts at demonstrated value moments, not before first value.

Success criteria:

- 10+ paying customers or a comparable number of signed paid pilots;
- 5–10% activated-to-paid conversion as an early directional target;
- support burden per active customer is falling, not rising;
- paid features correspond to observed repeat behavior.

### Phase C — monetize collaboration (next 2–3 months)

Goal: validate Household or micro-business collaboration, choosing one primary segment.

1. Pilot with 5–10 households or SMEs; do not serve both segments with identical messaging.
2. Harden invitations, capabilities, audit and approvals based on pilot behavior.
3. Add shared Inbox ownership/assignment and approval resolution where needed.
4. If SME demand wins, prioritize invoice/payment matching, expense approval, accountant access and monthly-close reporting.
5. If Household demand wins, prioritize shared goals, source privacy controls, contribution attribution and recurring obligation coordination.

### Phase D — scale connectors and distribution

Goal: make adapters repeatable without weakening trust.

1. Stabilize a connector SDK/fixture/contract around ADR 0007.
2. Add provider-template versioning, health metrics, replay and migration guidance.
3. Build Android capture only after policy review and a proven customer base; keep sender allowlists, local filtering, offline queueing and informed consent central.
4. Pursue bank/payment-provider partnerships where APIs improve reliability.
5. Expand geography through adapter packs and verified directory evidence, not generic unsupported enums.

## 12. Metrics that must exist before scaling spend

Product funnel:

- signup started -> email verified -> onboarding completed;
- source setup started -> credential paired -> first test/real event -> healthy at day 7;
- first Inbox item shown -> resolved -> repeat resolution;
- report enabled -> generated -> opened/delivered;
- Household invited -> accepted -> shared action completed.

Reliability/trust:

- ingestion attempts/success/failure/latency by adapter version, without raw payloads;
- duplicate candidate rate and oldest unresolved age;
- shadow-route mismatch rate and active-connection coverage;
- stale connector count and recovery time;
- report/job/email/reconciliation failure and queue age;
- unauthorized/ambiguous routing rejects;
- support cases involving missing, duplicate, or incorrectly classified money.

Commercial:

- activated weekly/monthly active users;
- week-1/week-4 retention;
- free-to-paid conversion and reason for upgrade;
- monthly recurring revenue, churn, gross margin and support time per customer;
- connector/report/Household feature usage by plan;
- customer acquisition source and payback period.

Do not optimize vanity page views. The core north-star candidate is **weekly active connected customers who receive at least one trusted event and resolve or consume at least one useful financial action/insight**.

## 13. Suggested next engineering tickets

1. **Release current branch:** rebase/update, run full gates, review migration/RLS and deploy auth + health + Inbox.
2. **Operational monitor:** add uptime check, secure header storage, alert destination, runbook owner and scheduler heartbeat dashboard.
3. **First-value telemetry:** add privacy-safe activation events and a funnel query/dashboard.
4. **Pairing UX:** one-time code/QR, prebuilt Shortcut bootstrap, test handshake that creates no ledger transaction, health confirmation and recovery.
5. **Canonical observation report:** automated daily coverage/mismatch/lifecycle gate report for Stage D/MTN canary.
6. **Two-tenant security suite:** RLS/capabilities/source visibility/raw-event collision/invite/service-role cases.
7. **MFA completion:** enrollment, factor list/removal, recovery guidance and step-up for credentials/members/payments.
8. **Privacy lifecycle:** export, delete, retention policy and raw-evidence purge/anonymization design.
9. **Inbox actions:** retain ownership in source workflows but reduce clicks and add resolution analytics.
10. **Paid-plan discovery:** instrument paid-value behaviors before writing billing code.
11. **One demand-led adapter:** choose from evidence, implement discovery/normalize/fixtures/replay/health/onboarding behind the canonical contract.
12. **Modularization:** extract query/domain services only while touching them for a user-facing outcome; avoid a broad rewrite.

## 14. Files to read before changing a domain

| Change area | Read first |
| --- | --- |
| Any web code | `web/AGENTS.md` and the installed Next 16 guide under `web/node_modules/next/dist/docs/` for the API being used |
| Product/security baseline | `ONELEDGER_AUDIT.md` |
| Connector/ingestion | ADR 0007, `docs/momo-ingest-contract.md`, `supabase/functions/ingest-momo/README.md` |
| Pay/QR/reconciliation | ADRs 0001–0004 and 0006, `docs/pay-and-services.md`, scan runbook |
| Spaces/RBAC | ADR 0005, `docs/oneledger-spaces-design.md`, authorization matrix, production-readiness doc |
| Reporting | `docs/reporting-engine.md`, reporting verification runbook |
| Auth/onboarding | `docs/onboarding-and-connections-design.md`, email deliverability doc |
| Shell/PWA | `docs/application-shell.md`, app-shell rollout runbook, brand-opening doc |
| Migration/backfill | migration README, Phase 3 report, Phase 4.1 readiness report |
| Operational health | `docs/operational-health.md` |
| Financial Inbox | `docs/financial-inbox.md` |

## 15. Final guidance to Claude Code

- Start from observed user value and trust risk, not feature count.
- Verify actual branch, CI, database and deployment state before reporting something as live.
- Preserve the non-custodial boundary and conservative financial review behavior.
- Build the next connector only through the provider-neutral contract.
- Keep rollout flags, observation gates and rollback paths until production evidence makes removal safe.
- Prefer a complete, measurable MTN MoMo onboarding experience over several half-built providers.
- Prefer one daily Financial Inbox loop over more dashboard charts.
- Prefer paying design partners and retention evidence over speculative enterprise surface area.
- When documentation and code disagree, investigate the current migration/code path, update the documentation in the same change, and state the discrepancy explicitly.

OneLedger already has unusually broad platform foundations for its age. The next challenge is not inventing more modules; it is turning those foundations into a narrow, trustworthy, measurable customer outcome that people will pay to repeat.
