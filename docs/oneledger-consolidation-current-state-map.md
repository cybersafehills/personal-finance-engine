# OneLedger Product Consolidation — Current-State Implementation Map

- **Date:** 2026-09-05
- **Author:** Discovery pass for the Product Consolidation program (no code changed)
- **Method:** Repository inspection of `main` @ `baba853`. Every audit finding
  (`ONELEDGER_AUDIT.md`, dated 2026-08-30) re-verified against current code.
- **Scope of this document:** the mandatory current-state map required by the
  master prompt §3–§4 and §79A, plus a phased execution plan. It is a
  prerequisite deliverable; no implementation has begun.

---

## 0. Headline

OneLedger is **substantially more mature than the master prompt's baseline
assumes**. The audit it references is five days stale and predates a large
amount of shipped work. **Both audit P0 defects are already closed in code.**
Most Release 1 ("Trust") items are done or nearly done. The genuinely open work
is concentrated in Releases 2–6 (design system, information architecture,
experience modes, onboarding state machine, actionable Inbox, connector
cutover, intelligence) plus a short list of verified small gaps in Release 1.

`ONELEDGER_PLATFORM_ASSESSMENT.md` referenced by the prompt **does not exist**
in the repository. Only `ONELEDGER_AUDIT.md` (2026-08-30) is present.

### Scale

| Metric | Count |
| --- | --- |
| App routes (`page.tsx`) | 96 |
| Route handlers (`route.ts`) | ~40 (17 cron, 10 `/api/v1`, rest internal) |
| SQL migrations | 128 (+ 4 report docs) |
| Edge Functions | 5 (`ingest-momo`, `capture`, `process-raw-events`, `reconcile-balances`, `send-notifications`) |
| ADRs | 11 (0001–0010, with two 0007s) |
| `web/lib` modules | ~90 top-level + `ai/ bills/ integrations/ pay/ spaces/ directory/ ussd/ api/ auth/` |
| `web/components` | ~110 top-level + `auth/ bills/ brand/ directory/ pay/ ussd/` |
| Feature flags (env-gated) | ~40 distinct `*_ENABLED` / `*_ALLOWLIST` / `*_SECRET` |
| Migration test suite | `run_migration_tests.sh`, 6,717 lines |

---

## 1. Architecture map

### 1.1 Trusted boundaries

| Boundary | Where | Notes |
| --- | --- | --- |
| Session client (RLS as the user) | `web/lib/supabase-session-server.ts` (`supabaseSession()`) | anon key + request cookie. All ordinary page reads/writes. This is the real tenant boundary. |
| Service-role client (RLS bypass) | `web/lib/supabase-server.ts` (`supabaseServer()`) | `server-only` import guard + non-`NEXT_PUBLIC_` key. |
| Browser client | `web/lib/supabase-browser.ts` | anon key only. |
| Route protection | `web/proxy.ts` | `auth.getUser()` for session refresh + redirect; **not** the security boundary. |
| Active workspace resolution | `web/lib/queries.ts` (`getActiveWorkspace`, cookie → membership validation) | |
| Cron auth | `web/lib/cron-auth.ts` (`isAuthorizedCronRequest`) | `REPORT_CRON_SECRET` in `x-report-cron-secret`, `timingSafeEqual`. Used by all `app/api/cron/*`. |
| Edge Function auth | per-function shared secrets, `verify_jwt = false` in `supabase/config.toml` | `ingest-momo` (per-connection key), `send-notifications` (`NOTIFICATION_CRON_SECRET`), `process-raw-events` (`RAW_EVENTS_PROCESSOR_SECRET`), `capture`, `reconcile-balances`. |

### 1.2 Service-role / RLS-bypass consumers (must be continuously tested)

- All 5 Edge Functions.
- All 17 cron route handlers (`app/api/cron/*`): reports, webhooks, bill
  monitoring, pairing expiry, payment-intent expiry, directory sweep,
  balance reconciliation, export jobs, integration syncs, accountant packages,
  API-log purge.
- New-user backfill tooling.
- `/api/admin/*` (operational health, email log, directory evidence).

### 1.3 Duplicated / divergent implementations

| Area | Canonical | Legacy / parallel | Status |
| --- | --- | --- | --- |
| Connector model | `connector_installations` + `financial_sources` + `accounts` + `device_credentials` (ADR 0007, migrations `20261011`–`20261023`) | `ingestion_connections` (one connection ⇒ one account; `20260823`, `20260923`) | **Dual-write + shadow-compare live.** Auth & routing still authoritative in legacy. Cutover gated on `ONELEDGER_CANONICAL_CONNECTIONS_UI` + `ONELEDGER_MTN_MOMO_ADAPTER`, pending a clean production observation window. |
| MoMo ingestion | `_shared/connector-adapter.ts` + `ingest-momo/adapter.ts` (`mtn_momo_sms_v1`) event-envelope route | `ingest-momo/index.ts` legacy path (1,285 lines) | Adapter route default-off (`ONELEDGER_MTN_MOMO_ADAPTER=enabled`). Both paths live. |
| Raw-event processing | `process-raw-events` Edge Function + `20261106_raw_events_processor` | inline processing inside `ingest-momo/index.ts` | Both live; `CANONICAL_INGESTION_ENABLED` referenced. |
| Oversized mixed-domain modules | — | `web/lib/queries.ts` **3,187 lines** (grew from 2,832), `report-generation.ts` 889, `ingest-momo/index.ts` 1,285 | Not split (audit F14). |

---

## 2. Data model map

### 2.1 Canonical chain (present today)

```text
auth.users
  └─ profiles
       └─ workspaces  (Personal auto-provisioned by handle_new_user trigger)
            └─ memberships  (role: owner|admin|member|viewer  + additive capability grants)
                 └─ financial_sources         (owned by a user; ADR 0005)
                      ├─ source_space_links    (explicit visibility into a Space; owner-controlled)
                      └─ accounts              (1..* per source in the canonical model)
                           └─ transactions     (integer minor units + currency; workspace-scoped)
                                └─ momo_message_id / raw_financial_event linkage (provenance)

raw_financial_events   (channel, payload_hash, ingestion_connection_id?, financial_source_id?)
momo_messages          (message_fingerprint, ingestion_connection_id?)  -- predates tenancy
```

### 2.2 Connector chain (ADR 0007, staged)

```text
connector_installations
  ├─ 1..* financial_sources ─ 1..* accounts        (discovery + ledger routing)
  └─ 1..* device_credentials ─ 0..1 account scope  (authentication only; owns no money)
```

- Stage A: schema (`20261011`).
- Stage B: preflight + reversible legacy backfill (`20261012`).
- Stage C: atomic enrollment, lifecycle mirroring, canonical provenance,
  shadow comparison, service-only shadow-health counters (`20261013`, `20261014`).
- Stage D: canonical credential resolver (default-off, `20261017`),
  multi-source discovery + deterministic route resolver (`20261018`),
  adapter route health (`20261019`), lifecycle (`20261015`), credential
  history (`20261016`), shared visibility (`20261023`).
- UI read projection ready: `web/lib/connector-read-model.ts`
  (`getCanonicalConnectorInstallations()`), `connector-ui-mode.ts`.
- **Divergence:** legacy `ingestion_connections` still binds one connection to
  one account and remains the authoritative auth/routing store. `momo_messages`
  still predates tenancy (nullable `ingestion_connection_id` for legacy rows).

### 2.3 Tenant-scoping of evidence / dedup (audit F2)

Migration `20261009000000_tenant_scoped_ingestion_dedup.sql` (Phase 0 hardening):

- `momo_messages`: dropped global `message_fingerprint` unique; added
  `ingestion_connection_id` FK; new partial unique
  `(ingestion_connection_id, message_fingerprint)`.
- `raw_financial_events`: dropped global `payload_hash` unique; added three
  partial uniques scoped by connection / source / `(channel, payload_hash)`.
- `transactions`: dropped global `external_id` unique; added
  `unique (workspace_id, external_transaction_id)`.
- `ingest-momo/index.ts` duplicate lookups now filter
  `.eq("ingestion_connection_id", connection.id)` throughout.

**Gap:** no regression test exists for this rescoping — neither an
`ingest-momo` two-tenant test nor a migration-suite assertion (grep for
`20261009` / `connection_fingerprint` / `raw_events_connection_payload` in
`run_migration_tests.sh` returns nothing). The audit (F2) and prompt (§9, §68)
both mandate it.

---

## 3. Authorization map

| Layer | Where | State |
| --- | --- | --- |
| Fixed roles | `memberships.role` = owner/admin/member/viewer | live |
| Named capabilities | `20260912_phase_r_spaces_authz_and_audit.sql` + integration capability set; documented in `docs/authorization-matrix.md` | live, ~28 capabilities enumerated (space.*, members.manage, budget/goal/rule/report/category.manage, transaction.create/categorize, audit.view, integration.* ×16) |
| Additive grants | member-scoped, workspace-scoped, cannot deny a role capability, do not cross workspaces | live |
| RLS policies | per-table; tenant isolation tested in `run_migration_tests.sh` ("RLS: tenant isolation", "Phase C adversarial cross-workspace", "Phase D category mappings", "Phase J reporting RLS", "Phase K report_artifacts zero access") | broad coverage |
| SECURITY DEFINER RPCs | payment orchestration, SMS reconciliation, statement import, invite redemption, connector enrollment, claim/ack notification | live; each needs `search_path` + caller/scope checks audited |
| Server actions | per route `actions.ts` | capability checks inconsistent vs RLS in older code (audit F6) |
| Service-role jobs | see §1.2 | bypass RLS by design |

**Fragmentation (audit F6):** newer integration code is capability-driven and
well documented in `authorization-matrix.md`; older core RLS leans on the
four role tiers. Effective per-resource matrix is partially documented, not
fully consolidated or exhaustively tested. `docs/authorization-matrix.md`
exists and is a good spine to extend.

---

## 4. Reliability map

| Stage | Mechanism | Idempotency / retry | Notes |
| --- | --- | --- | --- |
| Capture | `capture` Edge Function → `raw_financial_events` | payload-hash partial uniques (§2.3) | |
| Normalization / parse | `ingest-momo/parser.ts`, `policy-engine.ts`, `_shared/connector-adapter.ts` | deterministic | |
| Dedup | exact: connection-scoped fingerprint / payload-hash. advisory: `compute_transaction_fingerprint` → `transaction_duplicate_candidates` → `possible_duplicate` state + human review | exact = reject; fuzzy = surfaced, never auto-merged (ADR-aligned) | matches prompt §7 |
| Transaction creation | `ingest-momo/index.ts` (legacy) / adapter route | `(workspace_id, external_transaction_id)` unique + optimistic-loser treated as idempotent duplicate | |
| Raw-event processor | `process-raw-events` (secret-gated) | claim-based | |
| Notifications | `send-notifications` drainer | `claim_notification_emails` (claim token + 300s lease) → Resend with stable `Idempotency-Key` → `ack`/`release` RPCs | **F1 fully resolved.** No dead-letter table; failures logged + lease-expiry retried. |
| Scheduled reports | `api/cron/generate-reports`, `deliver-reports`; `report-generation.ts`, `report-delivery.ts` | `REPORT_GENERATION_ENABLED`, `REPORT_EMAIL_DELIVERY_ENABLED` kill-switches | |
| Cron fleet | 17 handlers, all behind `isAuthorizedCronRequest` | | no scheduler heartbeat / SLO evidence |
| Reconciliation | `reconcile-balances` Edge Function + `api/cron/run-balance-reconciliation`, `reconcile-pending-payments` | `BALANCE_RECONCILIATION_ENABLED`, `SMS_RECONCILIATION_ENABLED` | |
| Observability | structured JSON `console.*` everywhere; `web/lib/operational-health.ts` + `/api/admin/operational-health` + `/api/health/email` + `email-health-rules.ts` | | no external sink / aggregation / alerting confirmed (audit F10) |

---

## 5. Product-surface map

### 5.1 Current primary navigation (`web/lib/navigation.ts` + `AppShell.tsx`)

- **Permanent:** `Home` (`/`).
- **Movable (user-orderable, desktop header):** `transactions`, `categories`,
  `budgets`, `settings`.
- **Phone bottom bar (fixed 5):** Home · Transactions · **Pay** (elevated,
  centre) · Budgets · More.
- **Header icons:** merged **Inbox/Notifications** button; Reports button.
- **"More" prefixes:** `/inbox`, `/integrations`, `/categories`, `/reports`,
  `/settings`.

`navigation.ts` is already the single source of truth for both surfaces
(prompt §20 satisfied). Reports was already removed from primary nav.

### 5.2 Prompt's target IA vs today

| Prompt target (§19) | Today | Gap |
| --- | --- | --- |
| Home | `/` | Home is feature-tiled, not a financial-state page (§22) |
| Activity | `/transactions` (+ `/transactions/review`, `/transfers`, `/[id]`, `/new`) | no "Activity" umbrella concept; no ADR for an Activity read model (§43, §75) |
| Inbox | `/inbox` + `/notifications` (merged icon) | Inbox exists as a projection (`financial-inbox-model.ts`, 74 lines; `AttentionItemsCard`, `DuplicateReviewList`, `ReviewQueueList`) but is **not** the unified actionable decision layer of §33–§35 |
| Plan | `/budgets`, `/budgets/goals`, `/budgets/categories` | no unified "Plan" mental model over budgets + goals + recurring + forecast |
| More → Manage money / Space / Account / Advanced | flat-ish `/settings/*` (14 pages) + `/integrations/*` (18 pages) + `/admin/*` (directory + ussd) | settings overloaded (§53); admin/developer shells not visually separated from consumer surface (§21) |

### 5.3 Route inventory by domain (96 routes)

- **Auth / onboarding (10):** `/login`, `/signup`, `/verify-email`,
  `/auth/confirm`, `/auth/mfa`, `/auth/reset-password(/confirm)`,
  `/get-started`, `/onboarding/profile`, `/onboarding/preferences`,
  `/invite/[token]`.
- **Core ledger (12):** `/`, `/transactions(/[id]|/new|/review|/transfers)`,
  `/categories(/insights|/rules…7)`.
- **Plan (7):** `/budgets(/[id]|/new|/categories|/goals…4)`.
- **Inbox / reports (5):** `/inbox`, `/notifications`, `/reports(/[id])`,
  `/settings/reports`.
- **Sources / devices / pairing (9):** `/pair`, `/settings/sources(/import)`,
  `/settings/accounts`, `/settings/connections(/setup)`,
  `/integrations/connections(/pair|/setup)`.
- **Integrations (16):** `/integrations` + accountant, activity, developer,
  exports, imports(3), marketplace, reconciliation, sync(3).
- **Pay (13):** `/pay/[id]`, `/pay/new/[type]`, activity, recipients,
  reconciliation, suggest, templates, ussd(2), networks(3).
- **Bills (3):** `/bills(/[id])`, `/settings` cross-links.
- **Admin (14):** `/admin/directory/*` (11), `/admin/ussd/*` (3).
- **Settings (14):** index + accounts, appearance, connections(2), notifications,
  privacy, reports, security, sources(2), workspace.

**Observations:** duplicate connection entry points
(`/settings/connections`, `/settings/connections/setup`,
`/integrations/connections`, `/integrations/connections/pair`,
`/integrations/connections/setup`, `/pair`); overlapping source vs account vs
connection pages; `/inbox` and `/notifications` still distinct routes behind
one icon; technical vocabulary in `AdvancedConnectionSetup`, `ConnectionDetails`.

### 5.4 Experience modes (§18)

**Not implemented.** No Personal / Household / Business mode concept.
`SPACES_ENABLED` (+ allowlist) gates household Spaces; Business is only latent
in Bills / integration capabilities. Mode would be a new cross-cutting
experience-config primitive (candidate for a new ADR, §75).

---

## 6. Audit finding verification (F1–F15 vs current code)

| ID | Audit claim | Current state | Verdict |
| --- | --- | --- | --- |
| **F1** | Unauthenticated `send-notifications`, no claim/lease/idempotency | POST-only; `NOTIFICATION_CRON_SECRET` (≥32 chars) constant-time compare; `claim_notification_emails` claim-token + 300s lease; Resend stable `Idempotency-Key`; `ack`/`release` RPCs; structured redacted logs | **RESOLVED** (dead-letter table still absent — minor) |
| **F2** | Global SMS/evidence dedup across tenants | `20261009` rescopes every uniqueness key to connection/source/workspace; `ingest-momo` lookups filter by `ingestion_connection_id` | **RESOLVED in code; regression test missing** |
| **F3** | Backend password floor 6, no complexity, no breach check/captcha | `minimum_password_length = 8` ✅; `password_requirements = ""` ❌; `secure_password_change = false` ❌; no `[auth.captcha]` ❌ | **PARTIAL** |
| **F4** | MFA enabled but no UX | `/auth/mfa`, `/settings/security` with `MfaManager` (enroll/list/remove factors), `MfaChallenge`, AAL2 gating ("sensitive actions unlocked for this session") | **SUBSTANTIALLY RESOLVED** (recovery-code guidance + which actions step-up = verify) |
| **F5** | Email-agnostic bearer invite redemption | `/invite/[token]`, `CreateInviteForm`, `InviteItem`; RPC binding **not re-verified this pass** | **UNVERIFIED — check `20260912` invite RPC** |
| **F6** | Authorization fragmented role tiers vs capabilities | `docs/authorization-matrix.md` exists + broad; capability model live; older core RLS still role-tier; not fully consolidated/tested | **PARTIAL** |
| **F7** | Manual URL/header/JSON connection setup | `PairWizard`, `PairHandoff`, `ConnectionReadinessProbe`, device pairing v2 (ADR 0008), `/pair`, `/integrations/connections/pair`, pairing-session expiry cron, credential rotation on re-pair (`20261127`) | **RESOLVED** (technical `AdvancedConnectionSetup` still exists as fallback) |
| **F8** | No onboarding state machine | `web/lib/onboarding.ts` (90 lines), `/get-started`, `/onboarding/profile`, `/onboarding/preferences`, `OnboardingCard`, `OnboardingChoiceLink`, checklist behind `ONBOARDING_CHECKLIST_ENABLED` (+ allowlist) | **PARTIAL** — not a persisted milestone state machine (`intent → source → paired → verified → first_txn → first_review → first_insight`) |
| **F9** | One-connection/one-account model | ADR 0007 Stages A–D implemented as dual-write + shadow compare; canonical read model prepared; cutover gated | **IN PROGRESS (large remainder)** |
| **F10** | No production observability | structured logs; `operational-health.ts` + admin route; email-health rules | **PARTIAL** — no external sink / SLO / alerting |
| **F11** | Unvalidated `next` redirect | `web/lib/internal-redirect.ts` (`internalRedirectPath`) + `internal_redirect_test.ts` | **RESOLVED** (verify every `redirect(next)` call site uses it) |
| **F12** | No deletion/export/retention | `/settings/privacy` = hide-balance + privacy-mode only; no account-deletion or data-export workflow found | **OPEN** |
| **F13** | `next/font/google` breaks offline build; Turbopack root | `web/app/layout.tsx:3` still `import { Geist } from "next/font/google"` | **OPEN** |
| **F14** | Oversized modules | `queries.ts` 3,187 (worse), `report-generation.ts` 889, `ingest-momo/index.ts` 1,285 (but now has extracted siblings) | **OPEN** |
| **F15** | Mobile controls < 16px (`text-sm`) | `text-sm` in `LoginForm`, `SignUpForm`, ~128 component files | **OPEN** |

---

## 7. Preserved strong decisions (do not regress)

Non-custodial boundary (ADR 0001); integer minor units + currency (`web/lib/money.ts`
with SQL parity + `money_test.ts`); RLS as the tenant boundary; explicit
Workspace/Membership separation; source ownership + explicit Space visibility
(ADR 0005); revocable per-connection credentials + rotation on re-pair;
raw-evidence provenance retention; conservative dedup (exact reject / fuzzy
review); provider-neutral connector adapter contract (ADR 0007);
deterministic financial math; `navigation.ts` single source of truth;
structured redacted logging convention.

---

## 8. Phased execution plan

Ordering follows the prompt's Release sequence (§77), adjusted for what is
already done.

### Release 1 — Trust (mostly done; close the verified gaps)

| # | Work | Size | Risk |
| --- | --- | --- | --- |
| 1.1 | **Two-tenant dedup regression tests** — `ingest-momo` test (Tenant A + Tenant B, textually identical SMS on different connections, both processed independently, no leak) **and** a `run_migration_tests.sh` block asserting the `20261009` partial uniques (same fingerprint on two connections both insert; same connection rejects). | S | low |
| 1.2 | **Password policy** — set `password_requirements`, flip `secure_password_change = true`, decide on captcha / breach check; align `SignUpForm` copy; document new prod-dashboard steps. | S | low |
| 1.3 | **Redirect audit** — confirm every `redirect()` fed by caller input routes through `internalRedirectPath`; add a lint or test. | S | low |
| 1.4 | **Invite recipient binding (F5)** — verify `20260912` redemption RPC; add recipient binding or an explicit transferable-link invite type + migration test. | M | med |
| 1.5 | **Authorization matrix consolidation (F6)** — extend `docs/authorization-matrix.md` to every resource/action in §52; add missing capability-enforcement migration tests; make it the living matrix. | M | med |
| 1.6 | **Observability baseline (F10)** — formalize the structured-log field convention (request/correlation id, workspace surrogate, source id, stage, outcome, duration, retry); wire ingestion-lag / duplicate-rate / scheduler-heartbeat / notification-failure signals into `operational-health`. No new tracing platform. | M | low |
| 1.7 | **CI coverage** — add WebKit + iPhone-viewport smoke (login, signup, onboarding, amount fields, source setup, pairing, dropdown, keyboard focus / no iOS zoom) to `.github/workflows/ci.yml`. | M | low |

**Exit:** verified trust; CI proves mobile/WebKit; matrix is exhaustive.

### Release 2 — Core (design system + IA + shells)

Formal component system (Field, CurrencyInput, SourceStatusBadge,
ActionRequiredItem, FinancialTable/List, EmptyState/SetupState, StepWizard,
DestructiveConfirm, PermissionGate) — audit `web/components` first, refactor not
duplicate (`EmptyState`, `Badge`, `StatTile`, `StepWizard`-like `PairWizard`
already exist). Internal design-system reference route. Content/terminology
pass. Experience-mode primitive (**new ADR**). Re-cut IA to Home / Activity /
Inbox / Plan / More, all from `navigation.ts`. Home → financial-state page
(§22–§23, deterministic, no invented score). Settings reorg (§53) with
redirects. Admin/developer shell separation (§21).

### Release 3 — First Run

Persisted onboarding milestone state machine (§24), idempotent, resumable:
`intent_selected → source_added → device_paired → connection_verified →
first_real_transaction → first_review_completed → first_insight_seen`.
Intent step, value-promise step, source-first step, pairing integrated inline,
**synthetic connection test** distinct from ledger evidence (§29), first-real-
transaction review card (§30), first insight (§31), post-onboarding checklist.

### Release 4 — Inbox

Turn `/inbox` into the actionable decision layer (§33–§35): unify review,
duplicates, attribution, categorization, reconciliation, source health, budget
alerts, bill matching/approval; inline actions that call the authoritative
domain RPC (Inbox stays a projection); deterministic prioritization model.
Collapse `/notifications` into `/inbox`.

### Release 5 — Connections

Finish ADR 0007 cutover (§37): production observation window → flip
`ONELEDGER_MTN_MOMO_ADAPTER` then `ONELEDGER_CANONICAL_CONNECTIONS_UI` →
migrate remaining legacy consumers → retire `ingestion_connections` in a
separate deliberate migration. Connected Sources / Connected Devices UX
(§36, §38, §39). Ingestion convergence (§50–§51) with parity tests before
retiring the legacy `ingest-momo` path. Android hardening (§40). iOS
direction ADR (§41).

### Release 6 — Intelligence

Deterministic-first: recurring-transaction detection (explainable, §45),
conservative cash-flow forecast (known vs estimated, §46), spending-baseline
comparison, high-confidence anomaly detection, reconciliation insights, "Why
am I seeing this?" everywhere (§47). AI only for explaining/summarizing
deterministic facts (§48).

### Cross-cutting (every release)

Feature-gate server-side not just UI (§56); additive reversible migrations
with two-tenant tests (§57); accessibility (§59) and responsive (§60)
validation; error design (§66); audit logging for sensitive actions (§65);
analytics funnel events (§64); update docs + ADRs (§74–§75).

---

## 9. Open questions for the product owner

1. **`ONELEDGER_PLATFORM_ASSESSMENT.md` is missing** — is there a newer
   assessment to reconcile against, or is `ONELEDGER_AUDIT.md` the baseline?
2. **Release 1 is ~80% done.** Confirm we do the small gaps (§8 Release 1
   1.1–1.7) and then move to Release 2, rather than re-litigating closed items.
3. **Connector cutover (Release 5)** depends on a production observation
   window that this program can't fast-forward. Do we schedule it or treat the
   canonical model as "ready when telemetry says so"?
4. **Experience modes** — is Business in scope for this program at all, or
   Personal + Household only with Business kept latent?
5. Order preference: strictly Release 1→6, or parallelize Release 2 (design
   system / IA) alongside Release 1 gap-closure since they barely overlap?

---

## 10. Decisions (locked 2026-09-05)

`ONELEDGER_PLATFORM_ASSESSMENT.md` (2026-09-05) was supplied after this map's
first draft and is now the authoritative brief. It supersedes the audit's
status sections; audit findings F1–F15, the roadmap, and the "what not to
build" list still hold. The five open questions are resolved as follows,
derived from the assessment's own direction (§1 product model, §6 upgrade
plan, §6.6 monetization, §7 guardrails).

### Product direction (what OneLedger is becoming)

A **non-custodial financial operating system for fragmented, Mobile-Money-first
markets** (Rwanda first). Not a budgeting app. The wedge is *effortless MTN
MoMo ingestion + a trustworthy reviewable ledger*; everything else compounds on
the same person-owned-source / explicit-Space-visibility model. Lifecycle the
whole product must express: **Connect → Capture → Understand → Review →
Reconcile → Learn → Act**, and never hold or move funds.

### Monetization (feasible path, not built in this program)

Plan tiers that charge for **automation volume, collaboration, and operational
control** — never for a user's own data, export, deletion, or security:

| Plan | Value gated |
| --- | --- |
| Free | 1 Personal Space, manual + statement import, 1 source, full ledger + security + export |
| Personal Plus | automated ingestion, multiple sources, rules, scheduled reports, extended history, forecasting |
| Household | shared Space, members, shared goals, shared Inbox, source sharing |
| Business | multi-account, finance roles, approvals, Bills, reconciliation, professional reports, audit retention |

Later, secondary: developer-platform / marketplace revenue share, accountant
packages. The **entitlements domain is designed in Phase 3** (schema + gate
checks), payment processing only when separately requested.

### Answers

| # | Question | Decision |
| --- | --- | --- |
| 1 | Missing assessment doc | Resolved — the 2026-09-05 assessment is the brief. |
| 2 | Release 1 ~80% done — close gaps then move on? | **Yes.** Do the verified Phase-0 gaps only; do not re-open F1/F2/F7/F11 (closed). Then Phase 1 (IA + design system). |
| 3 | Connector cutover (ADR 0007 D→E) needs a prod observation window | **Treat as "ready when telemetry says so."** Do not block the program on it; it stays a Phase-2 (Release 5) item. All *new* connector work targets the canonical model; legacy `ingestion_connections` is not extended. |
| 4 | Experience modes — Business in scope? | **Build the mode primitive with all three modes** (Personal / Household / Business) as an experience-config that gates *surface visibility only*. **Do not build new Business features** — Business mode just reveals already-latent, still-flagged surfaces (Bills, accounting connectors, reconciliation). No custom roles / SSO / org-policy console (guardrail §7). |
| 5 | Strict order vs parallelize | **Lead with Phase 0** (trust gaps — small, de-risks everything), then Phase 1. Design-system extraction may begin in parallel since it does not touch trust code, but Phase 0 lands first. |

### Execution mapping (this program → assessment §8 backlog)

Phase 0 (now) → assessment §8 items 1–5. Phase 1 → items 6–10. Phase 2 →
items 11–14. Phase 3 → items 15–17. Phase 4 → item 18.

---

## 11. Progress log

### 2026-09-05 — Phase 0 started

| Item | Change | Status |
| --- | --- | --- |
| **F2 regression** | Added an 11-assertion "Phase 0: tenant-scoped ingestion dedup (F2 regression)" block to `supabase/migrations/tests/run_migration_tests.sh`: two-tenant identical-SMS survival + within-connection idempotency for `momo_messages`; connection / source / `(channel,payload_hash)` scoping for `raw_financial_events`; `(workspace_id, external_transaction_id)` scoping for `transactions`; legacy NULL-scope exemption. | ✅ Full suite **484 passed / 0 failed** locally (PG17 spawn mode). |
| **CI gap** | New `web-quality` job in `.github/workflows/ci.yml`: `npm ci` → `next lint` → `next build` with placeholder env. Fast, Supabase-free signal for lint regressions and build-time breaks (previously only implicit inside the e2e job). | ✅ `lint` + `build` green locally. |
| **F3 — password policy parity** | `supabase/config.toml`: `password_requirements = "letters_digits"`, `secure_password_change = true` (with dashboard-sync notes). New shared `passwordError()` in `web/lib/registration.ts` enforced by `validateRegistration` (signup) and `updatePassword` (reset-password confirm); `PASSWORD_REQUIREMENT_HINT` shown on both forms; `registration_test.ts` updated (+ new complexity test). | ✅ `deno test` 4/4, `lint`, `build` green. e2e password fixtures already satisfy the rule. |

| **F10 — structured logging** | New `web/lib/log.ts` + `supabase/functions/_shared/log.ts` (mirrored): one JSON line per event, stable `{ts,stage,outcome,correlation_id,duration_ms,…}` shape, `redact()` backstop (sensitive key names + secret-shaped values), `withLoggedRun()` for cron heartbeat. Co-located tests (6 + 5). `app/api/cron/generate-reports/route.ts` adopts it as the reference. New "Structured logging convention" section in `docs/operational-health.md`. `_shared/log` added to CI's `deno check` loop. | ✅ `deno test` 105/0 (`_shared`), 597/0 (`web/lib`); fmt + lint clean. |
| **F6 — authorization matrix** | `docs/authorization-matrix.md` rewritten from a 12-capability catalog into the §52 living matrix: the two enforcement styles (role-tier RLS vs closed capability catalog) named as the F6 fragmentation + convergence direction; full 34-capability × role table with grant/catalog provenance; per-resource/action table (18 resources: sources, links, accounts, transactions, categories, rules, budgets, goals, reports, members, invites, connections, connector installations, raw evidence, integrations, bills, pay, developer keys, export, deletion) with scope / RLS / RPC / UI / audited-vs-partial status; tracked-gaps section (F5, F6, F12). | ✅ doc-only. |
| **WebKit / iPhone CI** | `playwright.config.ts`: `visual.spec.ts` excluded from the `webkit-desktop` / `mobile-safari` / `chrome-android` projects (pixel regression stays chromium-only by design). `ci.yml` e2e job: installs `webkit`, runs `--project=webkit-desktop --project=mobile-safari` over the 201 functional/a11y/responsive tests as a **non-blocking** step (`continue-on-error`, `::warning` on failure, report uploaded) — to be promoted to required once hardened. | ✅ config parses; `playwright test --list` = 201 tests, `visual` excluded. Not executed here (needs local Supabase stack). |

### Deferred out of Phase 0 (with rationale)

- **F12 — account deletion / data export / retention.** Its own workstream:
  needs a product decision on retention windows and a carefully-tested cascade
  migration across the tenant schema. Tracked in `authorization-matrix.md §5`.
- **F5 — recipient-bound invites.** Assessment §8 item 18 explicitly places
  this in Release 4 (collaboration hardening). Current bearer model documented
  with its `accepted_by` audit compensation.
- **Full `partial` → `audited` sweep in the authz matrix.** Closing the
  remaining core-table mutation-RPC test gaps is Phase 1 work, done per-area as
  each is touched.

### Phase 0 verification summary

| Check | Result |
| --- | --- |
| `run_migration_tests.sh` (PG17) | **484 passed / 0 failed** (incl. 11 new F2) |
| `deno test supabase/functions/_shared/tests` | 105 / 0 |
| `deno test --config web/lib/deno.json web/lib` | 597 / 0 |
| `deno fmt --check` + `deno lint` (supabase/functions) | clean |
| `npm run lint` (web) | 0 errors (2 pre-existing warnings) |
| `npm run build` (web, placeholder env) | ✓ compiled |

Phase 0 committed as `e9546af`.

### 2026-09-05 — Phase 1 (Release 2) started

| Item | Change | Status |
| --- | --- | --- |
| **Design-system primitives** | `web/components/ds/` — `Field` (label/help/error/a11y via render-prop), `CurrencyInput` (integer-minor via `money.ts`, no float on a ledger value), `ConnectionStatusBadge`/`SourceStatusBadge` (canonical 7 states), `ActionRequiredItem` (Inbox row), `DestructiveConfirm` (type-to-confirm + MFA notice), `PermissionGate` (hide / show-disabled), `StepWizard`. `EmptyState` extended (optional `action`/`icon`/`variant="setup"`, backward-compatible). `docs/design-system.md`. | ✅ `e9546af`… committed `f728df4`; lint + build green |
| **16px mobile controls (F15)** | Already solved: `globals.css` `@media (max-width:767px)` forces `input/select/textarea` to 16px in one place. Documented in `design-system.md`; no code needed. | ✅ verified pre-existing |
| **Experience-mode primitive** | ADR 0011. `web/lib/experience-mode.ts` (pure: `ExperienceMode`, `experienceModeForWorkspaceKind`, `SurfaceKey`, `isSurfaceVisible`) — derived from `workspaces.kind` (personal/household/organization→business), **no migration**. `experience-mode/gate.ts` server resolver + `EXPERIENCE_MODE_BUSINESS_ENABLED`/`_ALLOWLIST` (dark). Wired `layout.tsx → AppShell → MoreSheet`: Integrations entry now also mode-gated (hidden for Personal regardless of `INTEGRATIONS_ENABLED`). 7 Deno tests. `.env.local.example` updated. | ✅ committed `21bf885`; deno 7/7, lint + build green |
| **queries.ts split (item 10)** | `web/lib/queries/` established with barrel re-export: `queries/transfers.ts` + `queries/variable-income.ts` (leaf domains, zero cross-deps). 3187→3002 lines. | 🔄 started, committed `3486ca0`; lint + build green, deno 604/0 |
| **Nav re-cut (Home/Activity/Inbox/Plan/grouped More)** | `navigation.ts` rewritten: `PRIMARY_NAV` (fixed journey, no reordering) + `PHONE_BAR_KEYS` + `MORE_GROUPS` (Manage money / This Space / Account / Advanced / Pay & Services, each item surface- + flag-gated). `AppShell` + `MoreSheet` rewritten; desktop gets a header "More" button opening the same grouped sheet. `nav_order` preference retired — `NavOrderForm` deleted, `/settings/appearance` now explains the fixed journey, `saveNavOrder`/`restoreDefaultNavOrder` removed, column left vestigial (no migration). 6 new `navigation_test.ts` tests. e2e `shell-navigation` + `nav-reorder` + `accessibility` + `visual` specs updated. | ✅ committed; deno 601/0, lint + build green. **Visual baselines need `--update-snapshots` (user running).** |
| **Admin / developer shell separation** | `app/admin/layout.tsx` — an "Operator tools" band on every `/admin/*` page so it never reads as a customer surface. `/integrations/developer` is already buried under More → Advanced (business mode + integrations flag). | ✅ committed |
| **Financial Inbox as single front door + inline actions** | `financial-inbox-model.ts`: `InboxInlineAction` union + `bill_review` kind. `financial-inbox.ts`: populates inline actions for category-review (confirm/dismiss), attribution ("This was mine"), rule-suggestion (accept/dismiss); adds `bill_review` items gated by `BILLS_ENABLED` + `bill.review`. New `components/InboxList.tsx` (client) dispatches each item's **authoritative domain server action** (the same RPC the drill-in uses), optimistically drops resolved items, `aria-live` + `aria-busy`, inline error keeps the item + drill-in link. `/inbox/page.tsx` rewritten on `ds/ActionRequiredItem`; heading now "Inbox" (matches nav). `e2e/inbox.spec.ts` smoke + `docs/financial-inbox.md` rewritten. | ✅ committed; deno 3/3 (model), lint + build green |

### Phase 1 verification summary (latest)

| Check | Result |
| --- | --- |
| `deno test --config web/lib/deno.json web/lib` | 601 / 0 |
| `npm run lint` (web) | 0 errors (2 pre-existing warnings) |
| `npm run build` (web, placeholder env) | ✓ compiled |
| Playwright visual baselines | **need `--update-snapshots`** after the nav re-cut (user running) |

### Commits on `claude/oneledger-consolidation-08bed7`

```
e9546af  Phase 0: close verified trust gaps (F2/F3/F6/F10 + CI)
f728df4  Phase 1: formalize design-system primitives
21bf885  Phase 1: experience-mode primitive (Personal / Household / Business)
3486ca0  Phase 1: begin splitting web/lib/queries.ts by domain
7ec517b  Phase 1: re-cut the primary navigation to the financial journey
<next>   Phase 1: Financial Inbox as the single front door + inline actions
```

### Phase 1 status: all five items delivered

Design system ✓ · 16px controls (pre-existing) ✓ · experience modes ✓ ·
nav re-cut + admin shell ✓ · Inbox front door + inline actions ✓ ·
queries.ts split 🔄 (pattern + 2 leaf domains; rest peels off per-area).

### 2026-09-05 — Release 3 (First Run) started

**PR1 — the persisted milestone spine (ADR 0012), dark behind
`ONBOARDING_JOURNEY_ENABLED`.**

| Piece | Detail |
| --- | --- |
| Migration `20261129000000_onboarding_milestones.sql` | 4 additive nullable columns on `profiles` (`onboarding_intent`, `_intent_at`, `_first_review_at`, `_first_insight_at`) + consistency constraint; `set_onboarding_intent` / `mark_onboarding_milestone` SECURITY DEFINER RPCs (idempotent, `auth.uid()`-scoped, authenticated-only); one-time backfill of established users' intent from their personal workspace `kind`. |
| Migration suite | 8 new "Release 3" assertions (columns, constraint, idempotency, derived-milestone rejection, cross-user isolation, ACL) + the function-count guard bumped 108→110. **493 passed / 0 failed** (PG17). |
| Pure model `web/lib/onboarding-milestones.ts` | 7-milestone ordered journey `intent_selected → source_added → device_paired → connection_verified → first_real_transaction → first_review_completed → first_insight_seen`; most **derived** (device-independent, idempotent), only 3 persisted. `deriveOnboardingJourney(signals)` → steps + next-step pointer + complete. 6 Deno tests. |
| Server reader `web/lib/onboarding/journey.ts` | collects derived signals (`financial_sources`, `ingestion_connections`, `transactions` counts) + persisted milestones; **deploy-drift safe** — a missing column is treated as "not yet". `ONBOARDING_JOURNEY_ENABLED` gate. |
| Intent step | `/onboarding/intent` (redirects to `/get-started` while dark) + `IntentChoiceForm` + `setOnboardingIntent` / `markOnboardingMilestone` actions. Uses `ds/StepWizard`. Value promise inline. |
| Synthetic connection test | **already exists** — `capture` `op:"test"` (ADR 0009) proves connectivity without a transaction; `connection_verified` reads `last_used_at`. |
| Docs | ADR 0012; `.env.local.example`. |

Verification: `deno test web/lib` 608/0; migration suite 493/0; web lint 0 errors; web build ✓.

**PR2 — the first-run surfaces (still dark behind `ONBOARDING_JOURNEY_ENABLED`).**

| Piece | Detail |
| --- | --- |
| `OnboardingJourneyCard` | dashboard checklist: progress, next step + CTA, remaining steps, dismiss (reuses `ui_preferences.onboarding_dismissed`). |
| `/get-started` journey view | when the flag is on, renders `getOnboardingJourney()` as the ordered step list — customer language, no raw "create a connection" choices. Old page unchanged when off. |
| `FirstTransactionReviewCard` | one review question on the most recent transaction; "Looks right" → `confirm_transaction_category` + `mark_onboarding_milestone('first_review')`; "Change category" → mark + drill in. |
| `FirstInsightCard` | one deterministic fact — biggest spending category so far from `getCategoryTotals()`; "Got it" → `mark_onboarding_milestone('first_insight')`. No invented score. |
| Home wiring | shows exactly one first-run surface at a time in journey order (review → insight → checklist), none once complete/dismissed; all gated by the flag. |

Verification: web lint 0 errors; web build ✓. No e2e/visual change (flag off in the e2e env).

**Release 3 remaining (polish):** value-promise / source-add as dedicated
wizard screens (today: value promise on `/onboarding/intent`, source-add
routes to `/settings/sources`); device pairing embedded in an onboarding
route vs. the checklist linking to `/pair`.

### 2026-09-05 — Release 5 (Connections / ADR 0007 cutover)

Per the locked decision (§10): the cutover depends on a production
observation window this program cannot fast-forward, so it is **not**
executed here. Delivered the parts that do not need the window:

| Piece | Detail |
| --- | --- |
| **ADR 0013** `docs/adr/0013-native-ios-capture-direction.md` | Native iOS App Intents / App Shortcuts companion as the long-term iOS capture path — same thin-client `/capture` + pairing-v2 contract as Android, zero-config setup, no forced migration off the Shortcut. Direction only, no timeline. |
| **Cutover runbook** `docs/connector-model-cutover-runbook.md` | The executable Stage D → E sequence: preconditions (shadow-mismatch = 0, adapter route health clean, `get_connector_canonical_read_cutover_status().ready`), flag-flip order (`ONELEDGER_MTN_MOMO_ADAPTER` → canonical credential resolver → `ONELEDGER_CANONICAL_CONNECTIONS_UI`), per-step verification + instant rollback, ingestion convergence parity gate before deleting the legacy `ingest-momo` pipeline, and Stage E as a separate deliberate migration (§73). Linked from ADR 0007. |
| **Status vocabulary unified** | `ConnectorInstallationItem` now uses the shared `ds/ConnectionStatusBadge` + `connectionStatusHint` (the canonical 7 states with fixed customer labels), so the connector UI, the Financial Inbox and future source cards all say the same words (§38). Preview-flag UI, no e2e. |

Verification: web lint 0 errors; web build ✓.

**Release 5 remaining:** the cutover itself (needs the prod window — follow
the runbook); Connected Sources / Devices "Send test" handshake + MFA
step-up on rotate/revoke (needs connector-RPC AAL2 work); Android
companion hardening review (§40); ingestion convergence parity fixtures.

### 2026-09-05 — Release 6 (Intelligence)

**PR1 — deterministic-first insights (ADR 0014), dark behind
`INTELLIGENCE_ENABLED`.**

| Piece | Detail |
| --- | --- |
| `web/lib/intelligence/cash-flow-forecast.ts` (pure) | `computeCashFlowForecast` — projects the balance over a horizon keeping **known/scheduled** (verified balance + dated recurring items + bill due dates) and **estimated** (minus a flat daily discretionary rate from 90-day history) separate at every checkpoint; reports projected low, projected end, `mayGoNegative`, a `basis` list, and a disclaimer. 6 Deno tests. |
| `web/lib/intelligence/insights.ts` (server) | `getIntelligenceInsights()` — gated; wires the previously-unwired `detectRecurringPatterns` over the last 4 complete months, derives the discretionary daily rate, builds the forecast, and computes a **spending-baseline comparison** (this-month-to-date vs same-first-N-days average of prior months; ±10% = above/below). |
| `ds/WhyThisInsight.tsx` | the "Why am I seeing this?" `<details>` disclosure — supporting facts, period, method, confidence. Required on every insight. |
| `IntelligenceCard.tsx` + Home wiring | text + one soft warning band, no charts; each block has its disclosure. Gated so no extra queries when off. |
| ADR 0014 | deterministic-first, no invented scores, known-vs-estimated never merged, recurring stays a heuristic, AI explains never computes, gated + no decorative charts. |

Verification: `deno test web/lib/intelligence` 6/0; web lint 0 errors; web build ✓. No e2e/visual change (flag off in e2e env).

**Release 6 remaining:** high-confidence single-transaction anomaly
detection; reconciliation insights; feeding `BILLS_ENABLED` bill due dates
into the forecast's scheduled list; wiring the forecast into `ai/facts.ts`
report commentary.

### 2026-09-05 — Release 4 (Inbox) remainder

The Inbox front door + first inline actions shipped in Phase 1 (`4bdbd74`).
This closes the rest:

| Piece | Detail |
| --- | --- |
| Duplicate inline actions | **Merge / Not duplicates** on a *clean 2-row cluster only* (exactly one open `possible_duplicate` + one keeper) → `merge_duplicate_transaction` / `dismiss_possible_duplicate` RPC. Ambiguous/larger clusters stay drill-in. |
| Reconciliation inline actions | **Confirm match / Not a match** on a *proposed* (non-conflict) candidate → `apply_payment_reconciliation` / `reject_payment_reconciliation`. Conflicts stay drill-in. Reconciliation is a first-class lane via its `critical`/`high` severity. |
| Prioritization refinement | Added `financialImpactMinor` to items; `buildFinancialInbox` factor order is now severity → age → money-at-stake (tie-break) → kind → id. Documented; no model ranking. |
| Wiring | `InboxList.tsx` gains the 4 new dispatchers (all call the authoritative domain RPC; optimistic drop + `aria-busy` + inline error unchanged). `financial-inbox-model_test.ts` +1 tie-break test. |

Verification: `deno test` (inbox model) 4/0; web lint 0 errors; web build ✓.
Bill approve stays drill-in (one-shot approve would skip the review step).

### 2026-09-05 — backlog follow-ups (PR #123, on `pfe/consolidation-4-followups`)

| Piece | Detail |
| --- | --- |
| Release 6 — amount anomalies | `web/lib/intelligence/anomaly.ts` (pure) — `detectAmountAnomalies`: one recent outflow ≥ 3× the median of the *same counterparty's* prior payments, given ≥ 4 priors + a meaningful absolute gap. Never a first payment, a volatile counterparty, or a trivial amount. 6 Deno tests. Wired into `insights.ts` + `IntelligenceCard` with a high-confidence "Why am I seeing this?". |
| Release 6 — bills in the forecast | when `BILLS_ENABLED`, open unpaid `bills` rows with a `due_date` inside the 30-day horizon are added to the forecast's KNOWN path as `bill_due` movements. |

Verification: `deno test web/lib/intelligence` 12/0; web lint 0 errors; web build ✓. Still gated by `INTELLIGENCE_ENABLED`. ADR 0014 updated.

**Remaining backlog:** reconciliation insights (needs a reconciliation-history query); wire the forecast into `ai/facts.ts` report commentary; "Send test" + MFA step-up on connector rotate/revoke (needs AAL2 in the connector RPCs); Android hardening review; full `queries.ts` split (needs `queries/core.ts` first); the connector cutover (prod window — follow the runbook).

### Files touched in Phase 0

```
docs/oneledger-consolidation-current-state-map.md   (new — this doc)
docs/authorization-matrix.md                        (rewritten — F6)
docs/operational-health.md                          (+ structured-logging section — F10)
.github/workflows/ci.yml                            (+ web-quality job; webkit e2e; _shared/log check)
supabase/config.toml                                (password_requirements, secure_password_change — F3)
supabase/functions/_shared/log.ts                   (new — F10)
supabase/functions/_shared/tests/log_test.ts        (new — F10)
supabase/migrations/tests/run_migration_tests.sh    (+ Phase 0 F2 regression block, 11 assertions)
web/lib/log.ts                                      (new — F10)
web/lib/log_test.ts                                 (new — F10)
web/lib/registration.ts                             (passwordError() shared floor — F3)
web/lib/registration_test.ts                        (+ complexity tests — F3)
web/app/signup/SignUpForm.tsx                       (PASSWORD_REQUIREMENT_HINT — F3)
web/app/auth/reset-password/actions.ts              (updatePassword validates — F3)
web/app/auth/reset-password/confirm/page.tsx        (requirement hint — F3)
web/app/api/cron/generate-reports/route.ts          (withLoggedRun reference — F10)
web/playwright.config.ts                            (exclude visual from cross-browser projects)
```

---

## 15. Follow-on — Account detail object (gap G3, branch `feat/account-detail-tabs`)

Off `main`. Master prompt §16/§24. `/settings/accounts/[id]` — one server page
with `?tab=` sections (Overview / Transactions / Connections / Rules / Access /
Settings), reached by clicking an account name on `/settings/accounts`.

| Change | File |
| --- | --- |
| `getAccountDetail(id)` (composes account + linked financial source + its Space links + bound `ingestion_connections` + source-scoped rules) and `getAccountTransactions(id, n)`; `AccountRow` gains `financial_source_id` + `created_at` | `web/lib/queries.ts` |
| The tabbed detail page | `web/app/settings/accounts/[id]/page.tsx` |
| Settings tab controls (rename / set primary / archive) reusing the existing actions | `web/components/AccountSettingsControls.tsx` |
| Account name on the list links into the detail object (list keeps its inline controls) | `web/components/AccountItem.tsx` |
| e2e | `web/e2e/account-detail.spec.ts` |
| Doc | `docs/account-detail.md` |

Read-only aggregation over existing RLS-scoped reads — no parallel management
path, no migration, no new RPC, no routes moved. deno `web/lib` 622/0, `next
lint` 0 errors, `next build` ✓.

Still open: G6 (F12 deletion/export/retention — own workstream, needs a
retention-window product decision), G7-G12.

---

## 13. Follow-on — Onboarding funnel analytics + setup review (gaps G4, G5)

Branch `feat/onboarding-analytics-review`, off `main` (Release 2-6 stack now
merged: `#128`/`#122`/`#127`). Closes G4 + G5 from
`docs/oneledger-onboarding-architecture-audit.md` §2.

**G4 — analytics** (`docs/onboarding-analytics.md`):
- `web/lib/onboarding/analytics.ts` — no-sink, redact-first module mirroring
  `lib/spaces/analytics.ts`. `OnboardingEventName` (10), `sanitizeOnboarding
  EventProps` (allow-lists the intent enum + milestone keys, drops ids /
  names / amounts / opaque strings), `trackOnboardingEvent` (never throws),
  and the pure `journeyCompletionEvents(prev, next)` diff for the derived
  milestones. `analytics_test.ts` 8 deno tests.
- Wired at the once-only transitions: `onboarding_started` /
  `profile_completed` / `preferences_completed` / `intent_selected` /
  `first_review_completed` / `first_insight_seen` in
  `app/onboarding/actions.ts`; `onboarding_dismissed` in
  `app/get-started/actions.ts`; `setup_review_viewed` on the review render.
  `onboarding_step_completed` / `onboarding_completed` are defined but not
  auto-emitted (need a stateful caller — see the doc).

**G5 — setup review screen** (master prompt §19):
- `web/app/onboarding/review/page.tsx` — "Your OneLedger setup": every
  milestone as ready / "Set up later", no shaming, `Go to Home` primary +
  `Finish setup` when incomplete. Reads `getOnboardingJourney()`, never
  writes. Flag-gated (`ONBOARDING_JOURNEY_ENABLED`) → redirects to
  `/get-started` when off, like `/onboarding/intent`.
- `/get-started` (journey branch) gains a "See your setup summary" link.
- `web/e2e/onboarding-review.spec.ts` — route-resolves-coherently smoke.

No migration, no routes moved. deno `web/lib` 630/0, `next lint` 0 errors,
`next build` ✓.

Still open from the audit: G2 (entitlements/Billing behaviour — next), G3
(account-detail tabs), G6 (F12 deletion/export), G7-G12.

---

## 12. Follow-on — Settings IA (gap G1, branch `feat/settings-ia-7group`)

Stacked on `pfe/consolidation-2-core`. Closes the largest user-facing gap
from `docs/oneledger-onboarding-architecture-audit.md` §2: the flat 10-row
Settings home is replaced by the seven named groups of master-prompt §110.

| Change | File |
| --- | --- |
| Single source of truth: 7 groups, rows, per-row visibility (experience mode + Spaces flag) | `web/lib/settings-navigation.ts` (new) + `settings_navigation_test.ts` (10 deno tests) |
| Settings home renders from it — grouped, described, filtered | `web/app/settings/page.tsx` (rewritten) |
| Post-onboarding profile + regional editing (reuses `save_onboarding_*` RPCs) | `web/app/settings/profile/page.tsx`, `web/components/ProfileSettingsForm.tsx` (new) |
| Billing & Plan home (static; entitlements domain is a later phase) | `web/app/settings/billing/page.tsx` (new) |
| Two Security rows → one "Security & Privacy" group; "Privacy and security" page retitled "Privacy"; Security page → "Sign-in & security" + back link | `web/app/settings/privacy/page.tsx`, `web/app/settings/security/page.tsx` |
| "Shared accounts" folded into "Spaces & Members" as "Account sharing" (route unchanged) | via `settings-navigation.ts` |
| e2e | `web/e2e/settings-ia.spec.ts` (new), `accessibility.spec.ts` / `visual.spec.ts` updated |
| Doc | `docs/settings-information-architecture.md` (new) |

No routes moved; no migration. Verification: deno `web/lib` 611/0, `next lint`
0 errors, `next build` ✓. Visual baselines for `settings-index.png` /
`settings-privacy.png` need regen with the rest of the Release 2 stack.

Still open from the audit: G2 (entitlements/Billing behaviour), G3
(account-detail tabs), G4 (onboarding-funnel analytics), G5 (setup review
screen), G6 (F12 deletion/export).
---

---

## 16. Follow-on — Account deletion request + data export (gap G6, branch `feat/account-deletion-export`)

Off `main`. ADR 0016. Closes the *request* + *export* half of audit F12
(§94-95). Dark behind `ACCOUNT_DELETION_ENABLED`.

| Change | File |
| --- | --- |
| `account_deletion_requests` (1/user, 30-day `scheduled_for`, RLS SELECT-own) + `request_account_deletion(reason?)` / `cancel_account_deletion()` SECURITY DEFINER RPCs; request blocked while the caller solely owns a shared Space with other active members | `supabase/migrations/20261201000000_account_deletion_requests.sql` |
| Migration suite: +8 assertions; guards 118→119 tables / 149→150 grants / 110→112 authenticated fns; **501/0** | `supabase/migrations/tests/run_migration_tests.sh` |
| Self-serve JSON data export (RLS-scoped, txns capped at 10k w/ truncation flag) | `web/lib/account-data.ts`, `web/components/DataExportButton.tsx` |
| Request state reader + flag | `web/lib/account-deletion.ts` |
| `/settings/privacy/data` page + controls + link from `/settings/privacy` | `web/app/settings/privacy/data/*`, `web/components/AccountDeletionControls.tsx` |
| Flag doc | `web/.env.local.example` |

**Irreversible erasure (`execute_account_deletion` + a cron) is explicitly
deferred** — ADR 0016 §3 carries its spec, incl. the full `auth.users` FK
inventory (most are plain NO ACTION and block `delete from auth.users`).

deno migration 501/0, `next lint` 0 errors, `next build` ✓. ⚠️ Guard-count
collision with G2 (#131): both bump the same literals — whichever merges
second needs a rebase + bump to 120/151.

Still open: G6 erasure follow-up; G7-G12.

---

## 14. Follow-on — Entitlements domain (gap G2, branch `feat/entitlements-domain`)

Stacked on `feat/settings-ia-7group` (G1). ADR 0015. Closes G2 from
`docs/oneledger-onboarding-architecture-audit.md` §2 to the "schema + engine
+ gate, dark" depth — no enforcement call sites changed, no payments.

| Change | File |
| --- | --- |
| Per-workspace plan table + default-free backfill + `ensure_workspace_plan` AFTER INSERT trigger; member-SELECT RLS, no authenticated write | `supabase/migrations/20261202000000_entitlements.sql` |
| Migration-suite: 8 assertions (backfill coverage, default, trigger, plan check, member/outsider RLS, denied member write, grants); guard counts 118→119 tables / 149→150 authenticated grants | `supabase/migrations/tests/run_migration_tests.sh` — **501/0** |
| Tier→capability map (single source, TS) + `planHasEntitlement`/`lowestPlanFor`/`planLabel`; 8 deno tests incl. the "no data/export/security entitlement" guardrail | `web/lib/entitlements/plans.ts` (+ `plans_test.ts`) |
| Server gate mirroring `experience-mode/gate.ts`: `ENTITLEMENTS_ENABLED` (+ `_ALLOWLIST`), `getWorkspacePlanState`, `workspaceHasEntitlement` (permissive when dark) | `web/lib/entitlements/gate.ts` |
| `/settings/billing` reads the real stored plan (was hard-coded "Free") | `web/app/settings/billing/page.tsx` |
| Flags documented | `web/.env.local.example` |

Verification: migration suite 501/0, deno `web/lib` 640/0, `next lint` 0
errors, `next build` ✓. Migration is additive + backfilled + trigger-covered;
deploys on merge when main CI is green (commit-only, user deploys). Generated
Supabase types not regenerated here (no project access) — regen on deploy;
`.from("workspace_plans")` compiles today.

Enforcement is the deliberate next step, per capability, behind
`ENTITLEMENTS_ENABLED`. Still open: G3 (account-detail tabs), G6 (F12
deletion/export), G7-G12.

---

## 19. Follow-on — email / PDF statement ingestion DESIGN (gap G10, branch `docs/g10-ingestion-adr`)

ADR 0018. **Design only** — G10 is genuinely L-sized (a PDF extractor + an
inbound-mail provider decision + an unauthenticated-endpoint security
review), so it is scoped into two shippable slices rather than rushed:

- **Slice A — PDF statement import** (lower risk): `/settings/sources/import`
  accepts `.pdf`, the Bills extractor's text/table layer produces candidate
  rows, the existing column-mapping UI + `import_statement_transactions`
  RPC do the rest. One flag (`PDF_STATEMENT_IMPORT_ENABLED`), no migration.
- **Slice B — email statement ingestion**: a per-user ingest address
  (`financial_sources.ingest_email_token`, one small migration) + an
  inbound-mail webhook writing `raw_financial_events(channel='email')` for
  the existing worker to drain. Needs a provider decision + security
  review; its own PR.

Key finding: **the seams already exist** — `raw_financial_events.channel`
permits `'email'`/`'statement'`/`'receipt'` (Phase Q), the raw-events
processor drains them, `import_statement_transactions` is the shared row
writer, and `web/lib/bills/extraction/` is a working PDF pipeline. No
schema change for Slice A.

**Audit gap status:** G1–G9, G11, G12 delivered; **G6 complete** (incl.
irreversible erasure); **G8** e2e scenarios delivered; **G10** designed
(ADR 0018), slices deferred.

---

## 17. Follow-on — Account erasure (gap G6 completion, branch `feat/account-erasure`)

Off `main`. ADR 0016 §3, closing the irreversible half of audit F12.
`20261203000000_account_erasure.sql` + a cron; dark behind the **separate**
`ACCOUNT_DELETION_EXECUTE_ENABLED`.

| Change | File |
| --- | --- |
| 5 `workspace_id` FKs (`accounts`, `categorization_policies`, `transactions`, `transaction_category_history`, `learned_policy_suggestion_decisions`) NO ACTION → CASCADE, matching every other workspace-scoped table | `20261203000000_account_erasure.sql` |
| `account_deletion_log` (no auth.users FK - outlives the erasure; service-role only) | ″ |
| `execute_account_deletion(uuid)` SECURITY DEFINER service-role-only: bottom-up teardown of the RESTRICT chain (raw events → txn-graph → transactions → momo_messages → device creds/pairing → ingestion → connectors), workspace cascade, owned sources/connectors, catalogue-driven null/delete of every remaining NO ACTION/RESTRICT `auth.users` FK, log, `delete from auth.users`. Re-checks P0001 + P0004. | ″ |
| `pending_account_deletions(int)` — the cron queue (scheduled + past `scheduled_for`), service-role only | ″ |
| `request_account_deletion` guard extended: also blocks while an owned source is shared into a populated Space (P0004) | ″ |
| Migration suite: +4 assertions (guard, full teardown vs. an intact household, P0004, queue+ACL); guard 120→121 tables. **513/0** | `run_migration_tests.sh` |
| `process-account-deletions` cron (cron-auth + `ACCOUNT_DELETION_EXECUTE_ENABLED`; per-user failure isolation, no user id in logs) | `web/app/api/cron/process-account-deletions/route.ts` |
| `isAccountDeletionExecuteEnabled()` + flag doc | `web/lib/account-deletion.ts`, `web/.env.local.example` |

The FK graph was captured from the real built schema (probe in the PR), not
a static list. deno migration **513/0**, `next lint` 0 errors, `next build` ✓.

**G6 is now complete.** Remaining audit gaps: G8 (named e2e scenarios), G10
(email/PDF ingestion).

---

## 20. Follow-on — PDF statement import (gap G10 Slice A, branch `feat/pdf-statement-import`)

ADR 0018 Slice A, **implemented**. Dark behind `PDF_STATEMENT_IMPORT_ENABLED`.

| Change | File |
| --- | --- |
| Pure PDF-text → rows heuristic: `itemsToLines` (positioned items → visual lines, page-break safe), `looksLikeAmount`, `linesToRows` (date+amount lines → `[Date, Description, Amount]`, running balance ignored). 6 deno tests. | `web/lib/pdf-statement.ts` (+ `pdf_statement_test.ts`) |
| `/settings/sources/import` accepts `.pdf`: the browser runs `pdf.js` (`pdfjs-dist`, dynamic import) to read the text layer, then the existing column-mapping + `import_statement_transactions` path takes over unchanged | `components/StatementImportFlow.tsx`, `app/settings/sources/import/page.tsx` |
| Flag doc | `web/.env.local.example` |

No AI, no server work, no migration, no new RPC/channel. Scanned-image PDFs
unsupported (CSV fallback). deno `web/lib` 656/0, `next lint` 0 errors, `next
build` ✓ (`new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url)`
worker).

**Merged to `main` as `a6ff3eb` (PR #140).**

---

## 21. Follow-on — email statement ingestion (gap G10 Slice B, branch `feat/email-statement-ingest`)

ADR 0018 Slice B, **implemented**. Provider: **Resend Inbound** (Svix-signed
webhook). Dark behind `EMAIL_STATEMENT_INGEST_ENABLED` (+
`INBOUND_EMAIL_WEBHOOK_SECRET` as an Edge Function secret). This closes G10.

| Change | File |
| --- | --- |
| `financial_sources.ingest_email_token` (nullable, unique, 32-hex `gen_random_uuid()`); owner-gated `set_/rotate_/clear_source_ingest_email` (authenticated) + `resolve_ingest_email_source` (service-role); `import_statement_transactions` body extracted into service-role core `_import_statement_rows(source, rows, actor?)`, authenticated wrapper now a thin `auth.uid()`+`owns_financial_source` check over it (manual CSV flow unchanged); service-role `import_statement_rows_for_source` wrapper for the webhook | `supabase/migrations/20261204000000_email_statement_ingest.sql` |
| Deno port of `web/lib/csv.ts` + `web/lib/statement-import.ts` + a body-line splitter (`linesToRows`) | `supabase/functions/_shared/statement-parse.ts` (+ `_shared/tests/statement_parse_test.ts`) |
| Resend Inbound webhook: Svix signature verify (`whsec_` base64, `${id}.${ts}.${body}` HMAC-SHA256, ±5 min), recipient-token extraction (never `From:`), Resend payload normalization, CSV/TSV attachments (column-guessed, ≤5 MB) + plain-text body → rows → `import_statement_rows_for_source` with a null actor. Missing config ⇒ HTTP 200 no-op. PDF attachments not parsed (web-only). | `supabase/functions/inbound-email/{index,lib}.ts` (+ `tests/lib_test.ts`, 14 tests) |
| `[functions.inbound-email] verify_jwt = false` | `supabase/config.toml` |
| CI: `deno check` + `deno test` for `inbound-email`, `statement-parse` added to `_shared` entry-point check | `.github/workflows/ci.yml` |
| "Email statements in" panel (generate / rotate / disable + address) on `/settings/sources/import`, flag-gated; `getSourceIngestEmails()` query; `enable/rotate/disableIngestEmail` server actions; 3 new `SpacesEventName`s | `web/components/EmailIngestPanel.tsx`, `web/app/settings/sources/import/{page,actions}.ts(x)`, `web/lib/{email-ingest,queries,spaces/analytics}.ts` |
| Flag docs | `web/.env.local.example` |

No new table, no new `channel` value (rows are `channel='statement'` like the
manual upload). Migration harness: **521/0**, `AUTHENTICATED_FN_EXEC_COUNT`
guard 112 → **115** (+3 owner-gated RPCs). deno fmt/lint/check ✓, new suites
`inbound-email` 14/0 + `_shared` `statement_parse` 6/0.

Deferred (not dark-ship blockers): per-token rate limit (Resend throttle +
signature gate + token space cover it for now), parse-failure quarantine
table (nothing is queued, so nothing drops silently — `no_rows`/`no_source`
logged with counts).
