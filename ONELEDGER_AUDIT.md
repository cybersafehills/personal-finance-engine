# OneLedger product and engineering audit

Date: 2026-08-30  
Repository: `personal-finance-engine`  
Scope: evidence-based review only; no product code, schema, credentials, or deployment changed.

## A. Executive summary

OneLedger is an ambitious, functioning financial operations prototype, not an ordinary CRUD expense tracker. The repository contains 547 tracked files, roughly 53k lines of TypeScript/TSX, 13k lines of SQL, 51 migrations, 69 pages, two Edge Functions, scheduled route handlers, and a meaningful automated-test estate. Its strongest engineering decisions are integer-money handling, a non-custodial payment boundary, server-side Supabase/RLS enforcement, explicit Workspace/Membership separation, revocable per-connection ingestion credentials, raw-event provenance, conservative duplicate review, and extensive ADR/runbook documentation.

It is not yet a polished financial platform suitable for broad paying-customer use. Its maturity is best described as **a strong developer-built beta with several platform-grade foundations**. The main blockers are two Phase-0 reliability/security defects, a technical Shortcut installation experience, incomplete device and connection abstractions, fragmented capability enforcement, no coherent first-value onboarding, a UI whose breadth now exceeds its information architecture, and operational gaps around monitoring and browser/device coverage.

The two highest-risk confirmed defects are:

1. **Unauthenticated email-outbox execution.** `supabase/config.toml:439-451` exposes `send-notifications` with JWT verification off, while `supabase/functions/send-notifications/index.ts:37-113` has no method or shared-secret verification before using the service role and Resend. When enabled, any caller can trigger a 50-message drain; concurrent invocations can duplicate mail because rows are acknowledged only after sending (`index.ts:92-101`).
2. **Global SMS evidence deduplication across all customers.** `momo_messages.message_fingerprint` is globally unique (`20260818000000_baseline_existing_schema.sql:132-151`), `raw_financial_events.payload_hash` is also globally unique (`20260910000000_phase_q_spaces_foundation.sql:463-474`), and ingest looks up only the normalized message hash (`ingest-momo/index.ts:162-207`). A second customer receiving textually identical provider SMS can be told it is a duplicate and lose the transaction. Statement import avoids this particular collision by including `financial_source_id` in its hash (`20260925000000_phase_u_statement_import.sql:124-137`).

The best commercial position is not “better budgeting.” It is **financial-source aggregation for fragmented markets, normalized into reliable activity, then automated into intelligence and collaborative action**. The strongest near-term wedge is effortless Mobile Money ingestion plus trustworthy review/reconciliation. Household and small-business collaboration can monetize later, after the underlying source/connection/account/permission boundaries are made consistent.

## B. Architecture map

```text
Next.js 16 web/PWA
  Server Components + Client Components
  Server Actions / Route Handlers
           |
  session-bound Supabase client (anon key + user cookie; RLS enforced)
           |
Supabase Auth -> profiles -> workspaces -> memberships -> capabilities
           |
financial_sources -> source_space_links -> accounts
           |
External SMS/Shortcut -> ingest-momo Edge Function -> momo_messages
  -> raw_financial_events -> parse/normalize/dedupe/policy evaluation
  -> transactions -> accounting effects/balances -> budgets/reports/alerts

Payment UI -> verified USSD/QR/provider handoff -> payment_intents/events
  -> later SMS reconciliation -> linked transaction (OneLedger does not hold funds)

Cron routes / Edge schedule -> reports, expiry, reconciliation,
directory verification, notification delivery
```

Ordinary user reads and writes use `web/lib/supabase-session-server.ts:5-37`; the service-role client is isolated in `web/lib/supabase-server.ts:1-26`. Route protection calls `auth.getUser()` in `web/proxy.ts:44-87`, but RLS—not middleware—is the real tenant boundary. The active workspace is cookie-selected then membership-validated in `web/lib/queries.ts:742-774`.

The ingestion path is more mature than the UI implies: a high-entropy per-connection key resolves workspace/account server-side (`ingest-momo/connection-resolver.ts:57-115`), the database enforces same-workspace account routing (`20260823000000_phase_c_accounts_and_ingestion_connections.sql:91-98`), raw evidence is retained, and canonical transactions carry dedupe and accounting fields. However, `momo_messages` predates tenancy and remains globally keyed, and `raw_financial_events` lacks an explicit tenant identity of its own.

## C. Product map

| Capability | State | Evidence / assessment |
|---|---|---|
| Email/password auth, verification, reset, sessions | Complete baseline | `web/app/login`, `signup`, `auth`; confirmation enabled in `config.toml`; session refresh in `proxy.ts` |
| MFA | Backend available, UX incomplete | TOTP enabled (`config.toml:331-347`); no enrollment/challenge UI found |
| Personal workspace | Complete | signup trigger provisions profile/workspace/owner membership (`20260821000000_phase_b_identity_and_tenancy.sql:190-221`) |
| Multiple workspaces / household | Beta/flagged | workspace switcher, invites, Household creation, source allocation; `SPACES_ENABLED` opt-in |
| RBAC/capabilities | Partial but real | owner/admin/member/viewer plus additive grants; matrix in `20260912000000_phase_r_spaces_authz_and_audit.sql:24-53` |
| Financial sources/accounts/connections separation | Partial | distinct tables exist; connection still binds directly to one account and provider model is narrow |
| MTN MoMo via iPhone Shortcut | Functional, poor installation UX | `ingest-momo`; manual endpoint/header/JSON instructions in `ConnectionDetails.tsx:52-188` |
| Airtel/bank/eKash ingestion | Schema/UI claims or directory support; not complete ingestion connectors | provider enums and pay directory exist; only MoMo Edge ingestion confirmed |
| Statement import | Functional beta | CSV normalization and security-definer import RPC; `StatementImportFlow.tsx`, Phase-U migration |
| Email/PDF/receipt ingestion | Planned/stubbed | raw-event channel enums exist, but no end-to-end connector/parser confirmed |
| Transactions, correction, review, splits, transfers | Substantial beta | pages/actions, accounting foundation, review and transfer detection |
| Categories/rules/learned suggestions | Substantial beta | categorization policies, history, apply preview, learned suggestions |
| Budgets/goals | Substantial beta | budget math and shared goals; very large action/math modules |
| Reports/AI commentary/email delivery | Beta | deterministic snapshots + optional AI; scheduler activation remains operationally separate |
| Notifications/action items | Partial | in-app notifications and attention cards exist; not yet a unified actionable inbox |
| USSD/Pay/QR | Experimental beta | verified directory, drafts/intents, scan classification and external handoff; settlement deliberately not claimed |
| Audit history | Partial | space/payment/directory audit tables exist; coverage is RPC/event-specific, not universal |
| Billing/subscriptions | Not implemented | no entitlement/subscription domain confirmed |
| Native iOS/Android app/device identity | Not implemented | browser sessions and ingestion connections exist, but no device entity or native app |

## D. Critical findings

| ID | Finding and recommendation | Priority | Category | Effort | Commercial | User | Risk |
|---|---|---|---|---|---|---|---|
| F1 | Authenticate `send-notifications`, restrict POST, add atomic claim/lease and provider idempotency. Public execution currently reaches service-role outbox processing (`send-notifications/index.ts:37-113`). | P0 | Security/Reliability | Medium | High | High | High |
| F2 | Scope raw/SMS evidence uniqueness by source or connection, migrate safely, and add a two-tenant regression test. Global fingerprint lookup can drop a second tenant's valid transaction (`ingest-momo/index.ts:174-207`; baseline schema `:150`). | P0 | Data integrity | Medium | High | High | High |
| F3 | Make backend password policy match UI and require stronger production policy; UI requires 8 but Supabase permits 6 with no complexity (`config.toml:198-201`; `SignUpForm.tsx:63-72`). Add compromised-password protection/captcha based on threat model. | P1 | IAM | Small | Medium | High | Medium |
| F4 | Ship MFA enrollment, recovery-code guidance, factor management and risk-based step-up for high-risk actions. TOTP is enabled but unreachable from product UX. | P1 | IAM | Medium | High | High | Medium |
| F5 | Replace email-agnostic bearer invite redemption with recipient binding or an explicit transferable-link invite type. Current RPC intentionally accepts any authenticated redeemer (`20260912000000_phase_r_spaces_authz_and_audit.sql:286-340`), including admin invites. | P1 | IAM/Workspace | Medium | High | High | High |
| F6 | Consolidate authorization on capabilities. Legacy core RLS uses broad role tiers while newer RPCs use named capabilities; document and test the effective matrix per resource. | P1 | RBAC | Large | High | High | High |
| F7 | Build guided connection enrollment with one-time pairing code, device-bound revocable credential, health check and test event. Current UI makes users manually edit URL/header/JSON (`ConnectionDetails.tsx:157-180`). | P1 | Integrations/UX | Large | High | High | Medium |
| F8 | Create an onboarding state machine/checklist driven by real milestones: workspace chosen, source created, connection verified, first transaction, first reviewed insight. Current signup ends at email confirmation and drops users into the general dashboard. | P1 | Onboarding | Medium | High | High | Low |
| F9 | Introduce a provider-neutral connector contract and connection-account mapping. Current `ingestion_connections` permanently binds one connection to one account (`20260823000000...sql:57-101`), which cannot represent a bank connection exposing several accounts. | P1 | Architecture/Integrations | Large | High | High | Medium |
| F10 | Add production observability: structured redacted logs, error aggregation, ingestion lag/failure/duplicate metrics, scheduler heartbeats and alerts. Current console logging is extensive but no sink/SLO evidence exists. | P1 | Reliability | Medium | High | Medium | Medium |
| F11 | Validate and clamp all redirect targets to internal paths. `signIn` passes caller-controlled `next` to `redirect()` (`login/actions.ts:17-61`); callback string concatenation is safer accidentally, not by a shared policy. | P1 | Security | Small | Medium | Medium | Medium |
| F12 | Add account deletion/export/retention workflows and privacy inventory. Financial data and raw SMS retention are durable, but no complete user-facing lifecycle was confirmed. | P1 | Privacy | Large | High | High | High |
| F13 | Self-host fonts and set the Turbopack root. `next/font/google` (`layout.tsx:3,21-24`) made the inspected production build fail offline; build also warned about workspace-root inference. | P2 | Reliability/Performance | Small | Medium | Medium | Low |
| F14 | Split oversized modules by domain. `web/lib/queries.ts` is 2,832 lines, `ingest-momo/index.ts` 947, `ScanToPay.tsx` 939, and `report-generation.ts` 887. | P2 | Maintainability | Medium | Medium | Medium | Medium |
| F15 | Standardize mobile controls at a 16px computed font size. Login/signup and numerous forms use `text-sm` (14px), e.g. `LoginForm.tsx:27-46`, which can trigger iOS Safari focus zoom. | P2 | Mobile UX | Small | Medium | High | Low |

No direct cross-workspace IDOR was confirmed in the reviewed main flows. Ordinary actions generally use the session-bound client and RLS; connection writes are protected by owner RLS plus a composite database foreign key. That is a real strength, but it must be continuously tested because service-role jobs bypass the boundary.

## E. UX/UI findings

The UI has a centralized token layer, visible focus, reduced-motion handling, privacy mode, skeleton/loading files, mobile bottom navigation, desktop navigation, and accessibility tests (`globals.css:3-97`, `AppShell.tsx`). It is more coherent than a typical prototype. It nevertheless feels like a developer-built beta because feature vocabulary is exposed directly (“ingestion connection,” endpoint, header, JSON), settings carry too many product concepts, advanced Pay/directory/admin functionality competes with the core financial journey, and many actions depend on users understanding the data model.

The shell is thoughtfully responsive, including documented fixes at 768px and PWA launch assets. Gaps: CI exercises Chromium desktop and unauthenticated projects only (`.github/workflows/ci.yml:188-232`), not WebKit/iPhone; mobile form text is commonly 12–14px; no verified mobile keyboard/inputmode audit covers amount/phone fields; and a 939-line scanner component is a regression risk. Existing screenshots and visual tests cover a useful but narrow set of screens.

Recommended design system evolution: retain existing restrained financial semantics, but formalize primitives for field/help/error, currency input, source/connection status, action-required item, financial table/list, destructive confirmation, permissions, and empty/setup states. Add content rules: customer language by default; implementation details only in a developer/advanced panel.

## F. Onboarding findings

The lifecycle is currently: signup -> email confirmation -> login -> broad dashboard -> user must infer that Accounts precede Connections -> manually wire Shortcut -> wait for a message. There is no persisted setup state, account-type choice, guided source test, sample mode, or explicit “first useful insight.” Empty states exist but are page-local, not a journey.

Recommended flow:

1. Choose Personal, Household, or Business intent (create only Personal immediately; defer collaborative configuration).
2. Promise the first outcome in plain language.
3. Add a financial source (Mobile Money first); infer the account record behind it.
4. Pair device with short-lived code/QR; install/test automation.
5. Show connection health and a safe synthetic test distinct from ledger data.
6. On first real event, ask one high-value review question, then show an insight.
7. Leave remaining setup as an unobtrusive checklist.

## G. IAM findings

Strengths: verified server sessions via `getUser`, refresh-token rotation, email confirmation, generic login failure behavior, application lockout, sign-out-other-sessions, high-entropy hashed tokens, server-only service role. Gaps: weak backend password floor; no visible MFA journey despite TOTP support; `secure_password_change=false`; no session/device list, recovery factor management, reauthentication gate for payments/invite/credential rotation, or deletion lifecycle. Login-attempt storage should also have explicit retention and privacy review.

## H. RBAC findings

Current roles are owner/admin/member/viewer. A capability matrix adds named permissions and additive per-member grants. This is directionally correct, but capabilities are coarse (`transaction.categorize`, not view/edit/delete/export scopes), exceptions can only grant—not deny—and legacy RLS still reasons through `is_workspace_member(min_role)` rather than the capability primitive.

Target: keep fixed roles as templates, enforce capabilities as the stable API, and allow scoped grants only when a real Business requirement appears. Near-term capabilities should cover transactions, accounts/sources, budgets/goals, reports/export, members/invites, integrations, workspace settings, audit, approvals and billing. Avoid custom-role UI until Business workflows validate it.

## I. Workspace findings

The repository no longer assumes `one user = one ledger`: users can hold multiple memberships and switch active workspace; financial sources are person-owned and can be explicitly linked into collaborative Spaces. This is a sophisticated privacy model (`20260910000000_phase_q_spaces_foundation.sql:80-160`). Remaining ambiguity comes from accounts being per-space representations while connections bind to accounts, and from “Household,” “organization,” and “Space” terminology evolving across migrations and UI. Establish canonical product terms and invariants before Business is added.

## J. Connections and Shortcuts findings

Connections already support one-time secrets, prefix display, pause/resume, rotate/revoke and last-used health. They are better modeled as credentials/endpoints than as full provider connections. Add separate entities for `connector_installation` (provider consent/config), `source_account` (institution account), and `device_credential` (delivery identity).

For a web-only near term, use a prebuilt shared Shortcut as a bootstrap plus authenticated pairing: user opens the Shortcut, supplies a one-time 6–8 character enrollment code (or scans QR), the first request exchanges it for a scoped, revocable device credential, and OneLedger verifies a challenge. Do not place a user’s long-lived key in a public iCloud shortcut link. Apple officially supports sharing Shortcuts through iCloud links; the scalable, polished route is a native companion app using App Intents/App Shortcuts, which makes preconfigured actions available after app installation without manual construction. Apple’s current App Shortcuts documentation supports preconfigured parameters and automatic discovery: [Apple App Shortcuts](https://developer.apple.com/documentation/appintents/app-shortcuts?changes=latest_major&language=o_2).

Design the pairing protocol as platform-neutral now: `platform`, `device_id`, `credential_id`, `capabilities`, `last_seen`, `app/automation_version`, and revocation. Android can later use the same API with a different local capture mechanism.

## K. Financial data architecture findings

The repository correctly distinguishes user, workspace, source, source-space link, account, ingestion connection and transaction. Integer RWF amounts, accounting-effect fields, transfers/splits/reversals, raw evidence, duplicate review and immutable report snapshots are strong. Risks are the global evidence keys, historical evolution of `momo_messages` without tenancy, provider-specific `amount_rwf` naming alongside multi-currency fields, and two concepts of balance/account representation. Define canonical money as `amount_minor + currency`; treat `amount_rwf` as legacy until safely migrated.

Keep the current normalization direction:

```text
Connector -> Raw event (tenant/source scoped) -> validation -> parser version
-> normalized event -> dedupe candidates -> classification/rules
-> canonical transaction -> accounting effect -> projections/reports
```

Do not auto-merge ambiguous financial records. Preserve the existing human-review bias.

## L. Security findings

**Critical:** F1 unauthenticated notification drainer.  
**High:** F2 cross-tenant evidence collision; F5 transferable privileged invites; F11 unvalidated redirect target; missing deletion/retention; incomplete high-risk reauthentication.  
**Medium:** password policy mismatch; no CAPTCHA; unvalidated `received_at` reaches timestamp inserts; lack of rate controls/abuse telemetry on ingestion; no CSP/security-header configuration in `next.config.ts`; broad service-role batch code must be explicitly scoped and tested.  
**Low:** stale lint suppressions and customer-visible credential prefixes (not secrets, but minimize unnecessary credential metadata).

Secrets are not tracked: only `web/.env.local.example` is in Git. The real `.env.local` and Vercel local file exist in the working directory but are ignored. No production credentials were printed or changed during this audit.

## M. Performance findings

Server-rendering and `Promise.all` are used well in the root shell. Likely hotspots are the broad `queries.ts` access layer, report generation loops, service-role reconciliation loop issuing one RPC per intent (`reconcile-pending-payments/route.ts:38-66`), and large interactive bundles for scanner/payment surfaces. Establish measurements before caching. Highest-value changes: batch reconciliation RPC, dynamic-load scan/pay tooling, query projections and indexes verified with explain plans, and bundle/query telemetry. Do not add distributed caches yet.

## N. Code quality and testing findings

Lint passes with two warnings in `LiveDataSync.tsx`. The build failed only because Google Fonts could not be fetched; it otherwise reached optimized compilation. The repository has 44 unit-test files and 16 E2E specs, plus migration-chain tests and pinned CI tooling. This is stronger than average.

Coverage gaps with the highest practical value: two-tenant RLS matrices, two-tenant raw-event collision, invite theft/admin redemption, notification-drainer authentication/concurrency, WebKit/iPhone onboarding, credential pairing/revocation, account deletion/export, and full reconciliation accounting invariants. CI should run lint and production build explicitly; current CI centers on Deno, migrations and Playwright. Add tests around service-role modules because RLS cannot protect mistakes there.

## O. Monetization opportunities

| Tier | Natural value boundary |
|---|---|
| Free | One personal workspace, manual entry/import, one source/connection, core categorization, basic monthly view |
| Personal Plus | Multiple automated connections, rules, scheduled reports, deeper trends, longer history/export |
| Household | Shared Space, source sharing controls, multiple members, goals/budgets, action inbox |
| Business | Multiple accounts/connectors, finance roles, approvals, invoice/receipt workflows, professional reports, audit retention |
| Future Enterprise | SSO, policy controls, custom roles, API/webhooks, advanced audit/export and support—not before demand |

Charge for automation volume, collaboration and operational control, not basic access to a person’s own data. Avoid paywalling export/deletion/security.

## P. Quick wins

1. Protect the notification drainer and expose last-run health.
2. Self-host Geist and set `turbopack.root`.
3. Validate internal redirect destinations in one helper.
4. Make all mobile form controls at least 16px and add `inputMode`/`autoComplete` consistently.
5. Rename customer-facing “Connections” copy around “Connected sources/devices”; hide HTTP details under Advanced.
6. Add connection state: setup incomplete, testing, healthy, stale, paused, error, revoked.
7. Add a “Send test” handshake that never creates a ledger transaction.
8. Add a dashboard setup checklist derived from real data.
9. Align password UI and Supabase policy; add strength guidance.
10. Surface TOTP setup in Security and explain recovery.
11. Add WebKit mobile login/connection smoke tests to CI.
12. Add explicit success feedback after imports, connection rotation and first transaction.
13. Add a retention/deletion explanation to Privacy settings.
14. Move raw endpoint/header/JSON content to a clearly labeled developer panel.
15. Add structured request/correlation IDs and redact raw financial text from routine logs.

## Q. Big bets

1. **Seamless Mobile Money onboarding:** device pairing, prepared automation/native App Intent, health and verification.
2. **Connector normalization platform:** one provider-neutral pipeline for SMS, statements, bank APIs, email and receipts.
3. **Financial Action Inbox:** a single queue for review, duplicates, connection failures, approvals and anomalies.
4. **Shared financial operations:** Household first, then small-business roles/approvals/audit on the same capability model.
5. **Trustworthy financial intelligence:** explainable rules, recurring patterns, cash-flow forecast and reconciliation—not generic chart proliferation.

## R. What not to build yet

- Do not become a custodian, wallet, card issuer, or settlement intermediary; keep provider handoff and verified reconciliation.
- Do not build microservices, Kafka, or a general-purpose workflow DSL yet. First unify current policy/rule/event execution inside the modular monolith.
- Do not build custom roles, enterprise SSO or organization policy consoles before Business usage validates them.
- Do not expand QR formats/providers faster than verification and reconciliation can support.
- Do not auto-merge duplicates or infer shared-source visibility.
- Do not build a full double-entry accounting suite; add only the ledger invariants required for balances, transfers, reversals and auditability.
- Do not add more dashboard charts until onboarding, ingestion reliability and actionability are fixed.
- Do not market email/PDF/bank integrations represented only by enums or stubs.

## S. Prioritized roadmap

**Phase 0 — trust boundary (1–2 sprints):** F1 notification auth/atomicity; F2 tenant-scoped evidence dedupe; redirect validation; cross-tenant and service-role regression tests; production alerts.

**Phase 1 — identity and data foundation (2–4 sprints):** password/MFA/step-up; capability inventory and enforcement matrix; canonical connector/source/account model; deletion/export/retention; terminology cleanup.

**Phase 2 — onboarding and connections (3–5 sprints):** milestone onboarding, pairing API, prepared Shortcut bootstrap, connection health/test, iOS WebKit QA, mobile form/design primitives.

**Phase 3 — actionable intelligence (3–5 sprints):** Financial Inbox, explainable categorization/recurrence, reconciliation queue, high-signal forecast/alerts.

**Phase 4 — collaboration (4–6 sprints):** harden Household, recipient-bound invites, audit completeness, scoped approvals; validate Business workflows with pilots.

**Phase 5 — commercial expansion:** entitlements/billing, plan limits, Business reporting/API, then enterprise controls only from evidence.

## T. Recommended target architecture

Keep a modular Next.js + Supabase monolith. Define modules and stable interfaces, not services:

- Identity: user, session, factor, device/session view.
- Tenancy: workspace, membership, role template, capability decision.
- Sources: institution/provider, connector installation, financial source, source account, device credential.
- Ingestion: raw event, parser, normalized event, dedupe/review, provenance.
- Ledger: canonical transaction, accounting effect, transfer/reversal/split, balance projection.
- Automation: triggers/conditions/actions implemented as constrained domain policies first.
- Intelligence: deterministic facts first; optional AI only explains those facts.
- Collaboration: attribution, approvals, action inbox, immutable audit.
- Delivery: notifications/reports with authenticated schedulers, leases, retries and idempotency.

Every tenant-scoped row should have an unambiguous workspace/source ownership path; every service-role operation must supply explicit trusted scope; every user mutation should be authorized at RPC/RLS level; every external credential should be scoped, rotatable, revocable and auditable.

## U. Top 10 next engineering tasks

1. Lock down `send-notifications`; implement atomic claiming and idempotent delivery tests.
2. Correct global MoMo/raw-event uniqueness and add a two-workspace collision migration test.
3. Add a comprehensive authorization matrix test suite covering roles, capabilities, RLS, source visibility and service-role scope.
4. Validate redirect targets and align production password/session security settings.
5. Deliver MFA enrollment/factor management plus step-up gates for credential, member and payment actions.
6. Write and approve the canonical Connector Installation -> Financial Source -> Account -> Device Credential model and migration plan.
7. Implement platform-neutral one-time device pairing and connection-health verification.
8. Build the milestone-based first-value onboarding/checklist and iPhone WebKit tests.
9. Add structured observability/SLOs for ingestion, duplicates, jobs, email and reconciliation.
10. Refactor the largest modules along the approved domain boundaries while adding the Financial Inbox read model.

## Verification performed and limitations

- Read repository structure, docs/ADRs, key UI/actions, Edge Functions, migrations, RLS/RPCs, CI and deployment configuration.
- `npm run lint`: passed; two warnings, no errors.
- `npm run build`: failed at external Google Fonts fetch; no source/type error reached before that dependency failure.
- Inspected existing unit/E2E/migration strategy; did not start Docker/Supabase, deploy, alter credentials, or run destructive migrations.
- This was a static repository audit. It did not test the live production system, real provider behavior, production RLS drift, or real iOS Shortcuts installation. Those require a separately approved, non-destructive staging/production verification plan.

