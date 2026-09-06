# OneLedger Onboarding & Product Architecture — Master-Prompt Audit

- **Date:** 2026-09-06
- **Branch:** `claude/oneledger-onboarding-architecture-64c3f0` (worktree), off `main` @ `ee7e118`
- **Method:** Repository inspection of `main`, plus `git diff` against the three
  open consolidation PRs (`#128` → `#122` → `#127`). No code changed.
- **Purpose:** the mandatory current-state audit required by the onboarding /
  product-architecture master prompt §3–§4, mapped section-by-section (§1–§115)
  to what is **shipped**, **in an open PR**, **partial**, a **gap**, or
  **consciously deferred**.

---

## 0. Headline

The master prompt describes an initiative that is **already ~80% designed and
built** across three prior programs in this repo:

| Program | Design record | Status |
| --- | --- | --- |
| **OneLedger Spaces** (Phases Q–W) | `docs/oneledger-spaces-design.md`, ADR 0005 | **Merged + live in prod** behind `SPACES_ENABLED=true`. `workspaces` row *is* the Space; Personal auto-provisioned by `handle_new_user`; Household = `workspaces.kind='household'`; person-owned `financial_sources` + explicit `source_space_links` visibility. |
| **Device pairing v2** | ADR 0008, `docs/device-pairing.md` | **Merged + live in prod, verified end-to-end** on a real device. "Connect this iPhone" pairing replaces manual `x-ingest-key` + endpoint + JSON. |
| **Product Consolidation** (6 releases) | `ONELEDGER_PLATFORM_ASSESSMENT.md`, `docs/oneledger-consolidation-current-state-map.md`, ADRs 0011–0014 | **Phase 0 merged** (`#120`). Releases 2–6 **built and in three stacked open PRs**, all dark behind flags. |

### The three open PRs

```
#128  pfe/consolidation-2-core       → main                     Release 2 (Core: design system, experience modes, IA re-cut)
#122  pfe/consolidation-3-features   → pfe/consolidation-2-core  Releases 3–6 (First Run, Inbox, Connections docs, Intelligence)
#127  pfe/consolidation-4-followups  → pfe/consolidation-3-features   Release 6 PR2 (anomalies + forecast bill dates)
```

**Merge blocker:** `#128` rewrites `navigation.ts` and the app shell, which
changes every snapshotted page; its e2e job stays red until Playwright visual
baselines are regenerated. That needs a local Supabase/Docker stack — a
**user-run step**, not doable from this environment:

```bash
cd web && npx playwright test --update-snapshots
git add web/e2e/*.spec.ts-snapshots && git commit -m "test(e2e): regen visual baselines for nav re-cut"
```
(run on `pfe/consolidation-2-core`).

### Flags that gate the in-PR work

`ONBOARDING_JOURNEY_ENABLED`, `EXPERIENCE_MODE_BUSINESS_ENABLED`
(+ `_ALLOWLIST`), `INTELLIGENCE_ENABLED`, plus the pre-existing
`ONELEDGER_CANONICAL_CONNECTIONS_UI`, `ONELEDGER_MTN_MOMO_ADAPTER`,
`ONBOARDING_CHECKLIST_ENABLED`, `SPACES_ENABLED`.

### Legend

| Mark | Meaning |
| --- | --- |
| ✅ **SHIPPED** | On `main`, mostly also deployed to prod |
| 🔷 **IN-PR** | Built, in open PR `#128`/`#122`/`#127`, dark behind a flag |
| 🟡 **PARTIAL** | Real coverage exists, meaningful remainder |
| ❌ **GAP** | Not built |
| ⏸️ **DEFERRED** | Consciously deferred with a recorded rationale |
| 📋 **PROCESS** | Methodology / philosophy — no single code artifact |

---

## 1. Section-by-section map (§1–§115)

### Objective & method (§1–§4)

| § | Requirement | Verdict | Evidence / notes |
| --- | --- | --- | --- |
| 1 | Redesign new-user experience so users need not learn internal structure | 🟡 PARTIAL | Registration→verify→profile→intent→space→account→connection→dashboard→assistant exists in pieces; the **intent step + milestone journey** is 🔷 in `#122`. Old `/get-started` checklist is ✅ on `main`. |
| 2 | Engineering priorities (security, reliability, …) | 📋 PROCESS | Upheld by ADR 0001 non-custodial boundary, RLS-as-tenant-boundary, integer minor units (`web/lib/money.ts`), migration test suite (6.7k lines). |
| 3 | Mandatory first-phase full audit | ✅ SHIPPED | `docs/oneledger-consolidation-current-state-map.md` (2026-09-05) + this doc. |
| 4 | Internal implementation plan before code | ✅ SHIPPED | Consolidation map §8 phased plan; `ONELEDGER_PLATFORM_ASSESSMENT.md` §8 backlog. |

### Domain model (§5–§7)

| § | Requirement | Verdict | Evidence / notes |
| --- | --- | --- | --- |
| 5 | Clear domain model: User → Space → {Members, Accounts→{Txns, Connections, Rules, Access}, Budgets, Reports, …} | ✅ SHIPPED | Exactly the ADR 0005 / consolidation-map §2.1 chain. `workspaces` = Space, `memberships` (+ additive capability grants), `financial_sources` (person-owned), `accounts` (1..* per source), `transactions` (minor units + currency, workspace-scoped). |
| 5 | Space types Personal / Household / Organization, extensible | ✅ SHIPPED | `workspaces.kind ∈ {personal, household, organization}`; adding a kind is additive. |
| 5 | Account ≠ Connection | ✅ SHIPPED | `financial_sources`/`accounts` vs `connector_installations`/`device_credentials` (ADR 0007) and legacy `ingestion_connections`. |
| 5 | Connection = how data arrives (Shortcut, Android, import, email, PDF, CSV) | 🟡 PARTIAL | iPhone pairing ✅ live; CSV/statement import ✅ (`import_statement_transactions`, `/settings/sources/import`); Android companion ✅ (ADR 0010); **email / PDF ingestion** ❌ not built. |
| 5 | Member/Access = an authorization relationship, not a separate object | ✅ SHIPPED | `memberships` + `source_space_links` + capability grants (ADR 0005, `20260912`). |
| 6 | Remove/rework standalone "Shared accounts" | 🟡 PARTIAL | Model reworked ✅ (person-owned sources + explicit Space links). **UI still exposes "Shared accounts" as a distinct settings row** (`web/app/settings/page.tsx`, `/settings/sources`). The §22–§28 IA restructure that folds it into "Spaces & Members" is ❌ not built. |
| 7 | Personal Space is the default ownership boundary, auto-provisioned, race-safe | ✅ SHIPPED | `handle_new_user` trigger provisions Personal on signup; immutable IDs; uniqueness enforced. Matches §71. |

### Registration vs onboarding split (§8)

| § | Requirement | Verdict | Evidence / notes |
| --- | --- | --- | --- |
| 8 | Separate authentication from financial setup | ✅ SHIPPED | `/signup`, `/verify-email`, `/auth/confirm`, `/auth/mfa` collect identity only; product setup begins after. Signup does not collect financial config. |
| 8 | Passwordless / passkey where implemented | 🟡 PARTIAL | MFA/TOTP + AAL2 step-up shipped (`/settings/security`, `MfaManager`). Passkeys not implemented. |

### New onboarding flow (§9–§20)

| § | Requirement | Verdict | Evidence / notes |
| --- | --- | --- | --- |
| 9 | Resumable, stateful, adaptive, accurate progress | 🔷 IN-PR | `#122`: ADR 0012, `web/lib/onboarding-milestones.ts` (7-milestone journey, mostly derived from live signals, only 3 persisted), `web/lib/onboarding/journey.ts` (deploy-drift safe). Old derived checklist (`web/lib/onboarding.ts`, 4 steps) is ✅ on `main`. |
| 10 | Profile & regional step; intelligent inferred defaults; server-side validation of country/currency/timezone/locale | 🟡 PARTIAL | `/onboarding/profile` + `/onboarding/preferences` ✅ on `main` (`ProfileOnboardingForm`, `FinancialPreferencesOnboardingForm`). Country/currency/timezone captured; **"automatically detected / [Change]" inference UX** is not explicit. Validation exists in actions. |
| 11 | Usage-intent step, multi-select, drives real behavior | 🔷 IN-PR | `#122`: `/onboarding/intent` + `IntentChoiceForm`; `set_onboarding_intent` RPC (idempotent, `auth.uid()`-scoped); intent feeds `deriveOnboardingJourney` + dashboard first-run surfacing. |
| 12 | Space-creation step (Personal default / Household / Organization) | ✅ SHIPPED | `/settings/workspace` "Start a household" + org path (Spaces program); Personal needs no creation. Not yet embedded as an explicit onboarding *step screen* — reached via settings. |
| 13 | Create first financial account during onboarding, reusing the real account service | 🟡 PARTIAL | Account creation exists (`/settings/accounts`); onboarding **links to it** rather than hosting an inline account form. Shared domain/service layer is reused. A dedicated in-flow account step is 🔷 partially in `#122`'s journey (checklist step → `/settings/accounts`). |
| 14 | Connect-transaction-source step, platform-aware, recommend best method | ✅ SHIPPED | Device pairing v2: `/pair`, `/integrations/connections/pair`, 5-step mobile wizard, deep-link + poll. Statement import as an alternative. "Configure later" supported. |
| 15 | Preserve & improve existing connection system (IDs, tokens, routing, dedup, status) | ✅ SHIPPED | ADR 0007/0008/0009 preserved connection identity, credential rotation on re-pair (`20261127`), dedup (exact reject / fuzzy review), `connection_verified` via `last_used_at`. |
| 16 | Account-centric connection management; account detail with Overview/Transactions/Connections/Rules/Access/Settings | ❌ GAP | `/transactions` filters by account; `/settings/accounts` lists accounts; there is **no tabbed account-detail object**. Connections still managed globally under `/integrations/connections`. |
| 17 | Adaptive optional onboarding (household invite / org roles / reports / budget / automation) | 🔷 IN-PR | `#122` journey + `FirstRunCards` branch on intent. Household invite / report enable exist as their own surfaces; not all wired as optional onboarding steps. |
| 18 | "Do this later" as a first-class, non-dark-pattern option | 🔷 IN-PR / ✅ | Old checklist is fully dismissible (`DismissOnboardingButton`, `ui_preferences.onboarding_dismissed`). `#122` journey is skippable per step. |
| 19 | Setup review screen | 🟡 PARTIAL | `#122` `/get-started` renders the journey step list; a distinct "Your OneLedger setup ✓/Set up later" review card is not a separate screen. |
| 20 | Persistent, non-intrusive Setup Assistant derived from real state | 🔷 IN-PR | `#122` `OnboardingJourneyCard` on the dashboard, state derived from live signals, collapses when complete. Old `OnboardingCard` is ✅ on `main`. |

### Empty states, Settings IA (§21–§30)

| § | Requirement | Verdict | Evidence / notes |
| --- | --- | --- | --- |
| 21 | Contextual educational empty states across the app | 🟡 PARTIAL | `web/components/EmptyState.tsx` exists and is extended in `#128` (`ds/` primitives). Not yet applied at every list surface with the §21 copy. |
| 22 | Redesign Settings IA into coherent groups | ❌ GAP | `web/app/settings/page.tsx` is still a **flat 10-row list** ("Appearance and navigation", "Privacy and security", "Accounts", "Connections", "Shared accounts", "Notifications", "Daily reports", "Security", "Spaces"). Incremental merges landed on `main` (`#114` reports-into-daily-reports, `#115` inbox+notifications icon) but the 7-group restructure was **planned in the consolidation map §8/Release 2 and not built** in `#128` (which only touches `/settings/appearance` + `/settings/privacy`). |
| 23 | Profile & Preferences group | ❌ GAP | Content exists (`/onboarding/profile`, `/settings/appearance`); not grouped. |
| 24 | Accounts & Connections group with account-level context preserved | ❌ GAP | See §16, §22. |
| 25 | Spaces & Members group; remove Spaces/Shared-Accounts split | ❌ GAP | `/settings/workspace` + `/settings/sources` are separate rows. |
| 26 | Reports & Notifications group; Daily Reports becomes one schedule type | 🟡 PARTIAL | `main` merged "Reports" into "Daily reports" (`#114`, commit `92fb8c4`) and Inbox+Notifications into one icon (`#115`, `3ecbce1`). The broader report/notification schedule model (weekly/monthly/alerts as types) is not generalized. |
| 27 | Security & Privacy group — merge the duplicate Security areas | 🟡 PARTIAL | Two entries still exist ("Privacy and security" + "Security"). MFA/sessions/privacy-mode all implemented; not consolidated into one group. |
| 28 | Data & Integrations group; Connection vs Integration defined | 🟡 PARTIAL | `/integrations/*` (18 routes: imports, exports, destinations, workbooks, reconciliation, accountant, developer, marketplace) is rich and ✅ shipped. It is not folded into a Settings "Data & Integrations" group, and the Connection-vs-Integration boundary is documented in `docs/integrations-architecture.md` but not surfaced in IA. |
| 29 | Billing & Plan group | ❌ GAP | **No billing/subscription/entitlement surface exists.** `grep` for `entitlement`/`billing`/`subscription`/`plan_tier` finds only unrelated webhook/analytics hits. |
| 30 | "Settings manages, onboarding introduces, app does work" principle | 🟡 PARTIAL | Direction is right; not enforced while Settings is still the discovery surface for core capabilities (§22). |

### Interaction & personalization (§31–§32)

| § | Requirement | Verdict | Evidence / notes |
| --- | --- | --- | --- |
| 31 | Universal `+ Add` interaction (Account/Transaction/Connection/Space/Budget/Member/Import) | ❌ GAP | No global add menu. Per-surface "Add" buttons only. Prompt itself makes this conditional on not conflicting with the Pay action. |
| 32 | Personalized home experience driven by intent; one product, adaptive emphasis | 🔷 IN-PR | `#122` `app/page.tsx` surfaces one first-run card at a time in journey order; `IntelligenceCard`; Spaces adds `HouseholdSpendingCard`. Full persona-weighted dashboard prioritization is partial. |

### Mobile & responsive (§33–§34)

| § | Requirement | Verdict | Evidence / notes |
| --- | --- | --- | --- |
| 33 | Mobile-first; no iOS focus zoom; safe-area; large targets; persisted back-nav | ✅ SHIPPED | 16px control floor enforced globally in `web/app/globals.css` `@media (max-width:767px)` (one place, ~line 115). Device-pairing wizard is mobile-first. (Audit F15's `text-sm` concern is mitigated by the global floor.) |
| 34 | Responsive desktop (max-widths, whitespace, focus management) | 🟡 PARTIAL | App shell is responsive; `#128` `AppShell`/`MoreSheet` rework improves it. No dedicated desktop onboarding layout pass. |

### Onboarding state architecture (§35–§38)

| § | Requirement | Verdict | Evidence / notes |
| --- | --- | --- | --- |
| 35 | Robust onboarding-state model (not a single boolean) — resumable, adaptive, multi-device, deferred, versioned | 🔷 IN-PR | `#122`: `20261129000000_onboarding_milestones.sql` — 4 additive nullable cols on `profiles` (`onboarding_intent`, `_intent_at`, `_first_review_at`, `_first_insight_at`) + `set_onboarding_intent` / `mark_onboarding_milestone` SECURITY DEFINER RPCs. Most milestones **derived from live resource state**, device-independent. |
| 36 | Onboarding versioning; existing users not force-re-onboarded | 🔷 IN-PR | `#122` migration backfills established users' intent from their personal workspace kind; journey reader treats missing columns as "not yet". No hard version integer, but the derive-from-state design makes re-onboarding structurally impossible for satisfied users. |
| 37 | Existing users protected (accounts, connections, shortcuts, reports, permissions survive) | ✅ SHIPPED | Every Spaces/pairing migration was additive + two-tenant tested; migration suite asserts pre-Spaces money fields are byte-identical after the Q→W chain (`#62`). |
| 38 | Existing-user migration rules (Personal Space assoc, no account → assistant, shared-account conversion without privilege broadening) | ✅ SHIPPED | Phase Q backfill (1 `financial_sources` per account), pairing auto-enrol for NULL-source accounts (`20261125`), `docs/spaces-production-readiness.md` migration invariants. |

### Database, auth, RLS (§39–§43)

| § | Requirement | Verdict | Evidence / notes |
| --- | --- | --- | --- |
| 39 | Safe, deterministic, reversible, idempotent migrations; inspect real schema; no premature drops | ✅ SHIPPED | 128 migrations; `run_migration_tests.sh` (6.7k lines) with tenant-isolation, adversarial cross-workspace, RLS-zero-access blocks. Legacy columns/tables retained during connector dual-write. |
| 40 | Authentication preserved & improved | ✅ SHIPPED | Signup/login/verify/recovery/MFA/session-revocation all present; `#112` fixed scanner-burned confirm links; Phase 0 `#120` set `password_requirements`, `secure_password_change`. |
| 41 | Server-side authorization for every Space/Account/Connection/report/txn action; reuse existing authz, no parallel logic | 🟡 PARTIAL | RLS-as-tenant-boundary + 34-capability catalog (`docs/authorization-matrix.md`, `20260912`). Audit **F6**: newer integration code is capability-driven; older core RLS leans on 4 role tiers; per-resource matrix documented but not exhaustively test-covered ("partial" rows remain). |
| 42 | Review every RLS policy touched by Personal-Space provisioning / memberships / accounts / connections / shared-account migration / onboarding state; test via UI and direct API | 🟡 PARTIAL | Broad RLS test coverage exists; a dedicated onboarding-state RLS review is light (RPCs are SECURITY DEFINER + `auth.uid()`-scoped + `search_path`-pinned, writing only the caller's own `profiles` row). |
| 43 | No "Activity" read model ADR | ❌ GAP | Consolidation map §5.2 flags this; `/transactions` is the de-facto activity surface, no umbrella ADR. |

### Connection security, validation, recovery (§43–§47)

| § | Requirement | Verdict | Evidence / notes |
| --- | --- | --- | --- |
| 43–44 | Connection security (high-entropy tokens, hashing, revocation, rotation, no token in logs, replay/dedup protection); layered validation | ✅ SHIPPED | 128-bit pairing tokens, 10-min TTL, single-use, credential rotation on re-pair, redacted structured logging (`web/lib/log.ts`, `_shared/log.ts`, `redact()` backstop), connection-scoped dedup fingerprints (`20261009`). |
| 45 | Failure recovery per onboarding step (no duplicate Spaces/accounts on retry; account survives failed connection; recover from real state) | 🟡 PARTIAL | Milestone derivation from real state gives most of this for free. Explicit idempotency keys on an onboarding *orchestration* endpoint are not present (there is no single multi-write onboarding transaction — steps are independent). |
| 46 | Transactional consistency for multi-step backend ops; prefer recoverable independent transitions | ✅ SHIPPED | Design deliberately uses independent recoverable state transitions rather than a distributed onboarding transaction. |
| 47 | Audit background jobs affected by timezone / reports / reminders; no duplicate schedules on migration | 🟡 PARTIAL | 17 cron handlers, all secret-gated; report scheduler honours Kigali month + per-source visibility (`#55`). A timezone-change → schedule-rewrite path is not explicitly tested. |

### Reports, notifications, flags, rollout (§48–§51)

| § | Requirement | Verdict | Evidence / notes |
| --- | --- | --- | --- |
| 48 | Preserve Daily Reports; refactor minimally toward daily/weekly/monthly/custom | 🟡 PARTIAL | Daily reports engine intact (`report-generation.ts`, `report-delivery.ts`); budget-threshold + report-alert thresholds added (`20261128`). Weekly/monthly not yet first-class schedule types. |
| 49 | Review notification prefs; avoid duplicate config between reports/email/in-app/push/alerts; honour prefs + Space perms + timezone | ✅ SHIPPED | Phase T/V: `notification_event_catalog`, `should_notify`, `enqueue_notification` fan-out gated per channel; `/settings/notifications` per-event toggles; `send-notifications` drainer with claim/lease/idempotency (audit F1 resolved). |
| 50 | Feature flags for risky changes; no permanent duplicate code paths; documented removal plan | ✅ SHIPPED | ~40 env flags; connector dual-write has a written cutover runbook (`docs/connector-model-cutover-runbook.md`). |
| 51 | Safe rollout sequence (schema → backend compat → Personal-Space migration → services → onboarding behind flag → Settings IA → existing-user assistant → validation → activation → legacy removal) | 🟡 PARTIAL | Spaces followed exactly this (`docs/spaces-production-readiness.md`). The onboarding/IA slice's rollout doc is the consolidation map §8; the Settings-IA and legacy-removal steps are unbuilt (§22). |

### Monetization & entitlements (§52–§53)

| § | Requirement | Verdict | Evidence / notes |
| --- | --- | --- | --- |
| 52 | Centralized entitlement system; no hardcoded `if plan === "premium"`; inputs = Space type, plan, entitlements, usage, use-cases | ❌ GAP | Not built. `ONELEDGER_PLATFORM_ASSESSMENT.md` §6.6 specifies the plan tiers (Free / Personal Plus / Household / Business) and says **"entitlements domain designed in Phase 3, payment processing only when separately requested"** — Phase 3 has not started. |
| 53 | Plan-aware onboarding (explain value, respect trials, don't hard-block setup) | ❌ GAP | Depends on §52. |

### Analytics & activation (§54–§55)

| § | Requirement | Verdict | Evidence / notes |
| --- | --- | --- | --- |
| 54 | Instrument the funnel (signup/verify/onboarding step/intent/space/account/connection/import/invite/report/budget/first-transaction/abandonment); no sensitive data to analytics | 🟡 PARTIAL | Domain-scoped analytics modules exist: `web/lib/spaces/analytics.ts` (13 events, sanitized), `web/lib/bills/analytics.ts`, `web/lib/pay/scan-analytics.ts`, `web/lib/directory/analytics.ts`. **No onboarding-funnel analytics module** (`onboarding_started/step_viewed/step_completed/intent_selected/…`). |
| 55 | Define "first value" (account created + connection understood) and stronger milestone (first real transaction) | 🔷 IN-PR | `#122` milestones `first_real_transaction`, `first_review_completed`, `first_insight_seen` are exactly these — persisted/derived, not yet emitted as analytics events. |

### Quality bars (§56–§69)

| § | Requirement | Verdict | Evidence / notes |
| --- | --- | --- | --- |
| 56 | Accessibility WCAG 2.1 AA; no placeholder-only labels | 🟡 PARTIAL | `web/e2e/accessibility.spec.ts` axe checks; `ds/Field` gives label/error association. Not a full app-wide sweep. |
| 57 | Loading states for every async op; prevent double-submit | 🟡 PARTIAL | `loading.tsx` added across Spaces surfaces (`#58`); form pending states common; not universal. |
| 58 | Useful success feedback, not toast spam | ✅ SHIPPED | Convention followed; page state reflects success. |
| 59 | Error feedback: explain, no leakage, recovery action, preserve input, actionable logs | 🟡 PARTIAL | `ds/` error patterns; `logSpacesError`/`redactErrorText`. Pairing flow specifically improved (`#104` unmasked RPC errors). Not app-wide. |
| 60 | In-context help for Space / Account / Connection terminology | 🟡 PARTIAL | `<details>` "How households work" (`#59`), `/settings/sources` primer, duplicate-review explainer. Not everywhere. |
| 61 | Update help/FAQ/tooltips; remove retired "Shared Accounts" terminology | ❌ GAP | Docs still describe "Shared accounts" (`settings/page.tsx`, `docs/*`). Depends on §6/§22. |
| 62 | Reusable domain/service logic; no duplicated business logic between onboarding and normal paths | ✅ SHIPPED | Onboarding is an orchestration layer over the same account/space/connection services + RPCs. |
| 63 | API contract review; consistent naming, typed payloads, structured errors, compat paths | 🟡 PARTIAL | `/api/v1` (developer platform) is versioned + typed; internal server actions vary. |
| 64 | Type safety; no unsafe casts | ✅ SHIPPED | `next build` + `tsc` green in CI (`web-quality` job, `#120`); generated DB types. |
| 65 | Performance: no excessive sequential requests in onboarding; parallelize; indexes | 🟡 PARTIAL | Journey reader is a single query. Audit **F13** (`next/font/google` in `web/app/layout.tsx` breaks offline build) still open. Audit **F14** (`queries.ts` 3,187 lines) partially split in `#128` (`queries/transfers.ts`, `queries/variable-income.ts`). |
| 66 | Query-pattern-driven indexes | ✅ SHIPPED | Partial/scoped indexes added with each Spaces migration (dedupe fingerprint, source links, etc.). |
| 67 | Cache correctness over caching; no permission-sensitive caching without invalidation | ✅ SHIPPED | Server components + `revalidatePath`; no permission-sensitive cache layer. |
| 68 | Audit logging for security/collaboration events | ✅ SHIPPED | `record_space_activity` / `record_space_audit_event`; invite/role/member/connection/goal events audited (Phase R). |
| 69 | Observability around onboarding transitions, provisioning, migration, account/connection creation, invites | 🟡 PARTIAL | Structured logging convention (`web/lib/log.ts`) + `operational-health.ts`. Audit **F10**: no external sink / SLO / alerting. Onboarding-transition logs specifically are thin. |

### Security review & race-safety (§70–§73)

| § | Requirement | Verdict | Evidence / notes |
| --- | --- | --- | --- |
| 70 | Explicit review for IDOR / broken access control / Space-switch tampering / invitation abuse / role escalation / token leakage / onboarding bypass | 🟡 PARTIAL | Spaces Phase W readiness review (`docs/spaces-production-readiness.md`) covers most; `anon`-zero-grant assertion on all Spaces tables. Audit **F5** (email-agnostic bearer invite) still UNVERIFIED / deferred to Release 4. |
| 71 | Race-safe Personal Space creation (one per user, idempotent) | ✅ SHIPPED | Trigger + uniqueness constraint; refresh cannot double-provision. |
| 72 | Race-safe account creation (double-click / retry / stale) | 🟡 PARTIAL | RLS + owner scoping; no explicit idempotency key on the account-create action. |
| 73 | Race-safe connection setup (no duplicate device registration, no reused handshake, no cross-account binding) | ✅ SHIPPED | Pairing sessions single-use + TTL; `consume_device_pairing_session` rotates the canonical credential (`#110`); server validates caller + workspace + account ownership + handshake state. |

### Navigation & Spaces UX (§74–§81)

| § | Requirement | Verdict | Evidence / notes |
| --- | --- | --- | --- |
| 74 | Clearer top-level nav (Home / Activity / Inbox / Plan / … ), single source of truth | 🔷 IN-PR | `#128` rewrites `web/lib/navigation.ts` → fixed journey `PRIMARY_NAV` (Home / Activity / Inbox / Plan), `PHONE_BAR_KEYS`, grouped `MORE_GROUPS`, retires `nav_order`. **`main` still has the old movable `nav_order` model** (`MOVABLE_NAV_KEYS = [transactions, categories, budgets, settings]`). |
| 75 | Keep mobile bottom bar small; priority + overflow | 🔷 IN-PR / ✅ | Fixed 5-slot phone bar with elevated Pay is ✅ on `main`; `#128` refines the "More" grouping. |
| 76 | Fast Space switcher; permissions update immediately; no cross-Space data leak; URL enforces access | ✅ SHIPPED | Kind-labelled Space switcher + "Create a Space" in account menu + current-Space chip (Phase S PR2c); `active_workspace_id` cookie validated against membership on every read. |
| 77 | Account access presentation inside shared Spaces (per-member access rows) | 🟡 PARTIAL | `source_space_links` visibility modes (nothing / transactions / balance) surfaced on `/settings/sources`; transaction attribution panel per member. A per-account "who can access" roster view is light. |
| 78 | Architecture supports org scale (many users/accounts/roles, approvals, reconciliation later) | ✅ SHIPPED | Capability model + additive grants + org `workspaces.kind`; Bills/reconciliation/accountant surfaces exist behind flags. |
| 79 | Household stays approachable (no enterprise terms) | ✅ SHIPPED | "Invite member", "Can view account" — Spaces UX copy is consumer-first. |
| 80 | i18n readiness (ISO currency, IANA tz, locale-aware numbers/dates) | ✅ SHIPPED | `web/lib/money.ts` integer minor units + currency; tz stored as IANA; `Intl` formatting. Strings not externalized to a catalog (English-only today, acceptable per §80). |
| 81 | Country-aware editable defaults | 🟡 PARTIAL | Country/currency captured; a country→provider/currency recommendation map is not implemented. |

### Data minimization, privacy, connection UX (§82–§89)

| § | Requirement | Verdict | Evidence / notes |
| --- | --- | --- | --- |
| 82 | Onboarding data minimization | ✅ SHIPPED | Only name/country/currency/timezone/intent collected. |
| 83 | Privacy disclosures where config affects ingestion / email parsing / connected devices / shared data | 🟡 PARTIAL | Pairing wizard explains what the connection does; `/settings/privacy` = balance hide + privacy mode. No dedicated ingestion-privacy disclosure screen. |
| 84 | First-connection explains: what it does, what it reads, where stored, how to disconnect, automatic? | ✅ SHIPPED | Pairing wizard + `docs/oneledger-capture-shortcut.md` + Verify step readiness probe; disconnect via connection lifecycle (pause/resume/revoke, `20260923`). |
| 85 | Shortcut setup made easy ("Connect this iPhone", one-time handshake, preconfigured Shortcut) | ✅ SHIPPED | Device pairing v2 live end-to-end; two published iCloud Shortcuts + `NEXT_PUBLIC_MOMO_SHORTCUT_URL` / `_CAPTURE_SHORTCUT_URL`. Residual manual step (Messages automation) is an Apple constraint, documented. |
| 86 | Android readiness; platform-neutral Connection/Device/Source/Provider concepts | ✅ SHIPPED | ADR 0007 provider-neutral connector model; ADR 0010 Android companion; `capture` contract shared iOS/Android. |
| 87 | Import integrated into first-account setup | 🟡 PARTIAL | `/settings/sources/import` (CSV + column mapping) shipped; not offered inline as a first-account "how to add transactions" option. |
| 88 | Connection health surfacing (Connected / last received / needs attention / disconnected); no alarming warnings on quiet periods | ✅ SHIPPED | `ds/ConnectionStatusBadge` / `SourceStatusBadge` (canonical 7-state vocab), `connectionStatusHint`; `ConnectionReadinessProbe` live poll. |
| 89 | Post-onboarding recommendations from real product state; dismissible, permission-aware, non-repetitive | 🔷 IN-PR | `#122` `FirstRunCards` (review most-recent txn, biggest-category insight) + `IntelligenceCard`. Not a general recommendation engine. |

### Writing, consistency, destructive actions (§90–§95)

| § | Requirement | Verdict | Evidence / notes |
| --- | --- | --- | --- |
| 90 | Onboarding is not a sales form | ✅ SHIPPED | Intent step is setup-shaping, not lead-gen. |
| 91 | Concise UX writing; named actions over "Continue" | 🟡 PARTIAL | Newer surfaces (`ds/`, pairing) do this; older forms mixed. |
| 92 | Design consistency (reuse tokens, no second design system) | 🔷 IN-PR | `#128` formalizes `web/components/ds/*` over existing tokens (`docs/design-system.md`). |
| 93 | Settings screen easier to scan (grouping, headings, supporting text, hierarchy) | ❌ GAP | See §22. |
| 94 | Destructive-action review (delete account/Space, revoke connection, remove member, leave Space, delete profile); prevent when dependencies need reassignment | 🟡 PARTIAL | `ds/DestructiveConfirm`; last-owner guard; connection revoke/pause. Audit **F12** (account deletion / data export / retention) **OPEN** — own workstream, needs a retention-window product decision + cascade migration. |
| 95 | Prefer account archival over deletion; preserve history | 🟡 PARTIAL | Accounts archive; a formal archival-vs-delete policy doc is absent (ties to F12). |

### Testing & QA (§96–§103)

| § | Requirement | Verdict | Evidence / notes |
| --- | --- | --- | --- |
| 96 | Comprehensive unit / integration / authorization / e2e coverage | 🟡 PARTIAL | Strong: migration suite ~250+ assertions, `deno test` 600+ in `web/lib`, Playwright functional/a11y/visual. Onboarding-journey e2e is thin (`#122` adds `inbox.spec.ts`; no full first-run scenario spec). |
| 97 | Required e2e scenarios A–G (personal+MoMo, defer connection, household, org, interrupted setup, connection failure, existing-user migration) | 🟡 PARTIAL | `spaces-household.spec.ts` (A/C-ish, single user), `signup-email.spec.ts`. B/D/E/F/G not covered as named scenarios. |
| 98 | Responsive QA at 320 / iPhone / Android / tablet / laptop / desktop | 🟡 PARTIAL | `#120` adds non-blocking WebKit + `mobile-safari` + `chrome-android` Playwright projects (201 tests). Not yet a required gate. |
| 99 | Accessibility QA (keyboard, SR labels, focus restore, no traps, progress semantics) | 🟡 PARTIAL | axe smoke; not a full manual pass. |
| 100 | Adversarial security QA (cross-Space IDs, account-ID swap on connection, stale invite, duplicate Personal Space, handshake reuse, entitlement tampering) | 🟡 PARTIAL | Migration suite has adversarial cross-workspace blocks; pairing handshake reuse covered. Entitlement tampering N/A (no entitlements). A dedicated onboarding-endpoint adversarial spec is absent. |
| 101 | Migration QA (record counts, ownership, linkage, no duplicate Personal Spaces, no permission broadening) | ✅ SHIPPED | `docs/spaces-production-readiness.md` invariants + `#62` migration assertions. |
| 102 | Build/static quality gates (format, lint, tsc, unit, integration, e2e, prod build, migration validation) | ✅ SHIPPED | CI: `web-quality` (lint + build), `deno` jobs, migration-chain job, e2e job. |
| 103 | Regression review (auth, accounts, ingestion, Shortcuts, connections, categories, rules, budgets, reports, notifications, Spaces, invites, RBAC, exports, Pay, nav) | 🟡 PARTIAL | Each program ran its own regression pass; `#128`'s nav rewrite needs the visual-baseline regen before a clean regression signal. |

### Documentation & delivery (§104–§115)

| § | Requirement | Verdict | Evidence / notes |
| --- | --- | --- | --- |
| 104 | Update repo docs (onboarding arch, state model, Space model, Account/Connection, sharing, migration, authz, analytics events, flags, rollout, dev testing) | 🟡 PARTIAL | Extensive: ADRs 0005/0007/0008/0009/0010/0011/0012/0013/0014, `docs/oneledger-spaces-design.md`, `docs/device-pairing.md`, `docs/onboarding-and-connections-design.md`, `docs/design-system.md`, `docs/authorization-matrix.md`, this doc. Missing: a single "onboarding architecture" doc and an analytics-events catalog. |
| 105 | Comments only for non-obvious architecture/security decisions | ✅ SHIPPED | House style; migration/authz logic is commented. |
| 106 | Deployment readiness (migration order, compat, sequencing, env vars, flag state, rollback, jobs, templates, analytics) | 🟡 PARTIAL | `docs/spaces-production-readiness.md`, `docs/connector-model-cutover-runbook.md`, `docs/app-shell-rollout-runbook.md`. The onboarding/IA slice needs its own readiness note once §22/§52 land. |
| 107 | Target first-time Personal flow (register → verify → confirm region → intent → Personal Space auto → Mobile Money → create → connect phone → summary → dashboard) | 🔷 IN-PR | End-to-end pieces exist; `#122` stitches intent + journey + first-run cards. The explicit summary screen (§19) is the weakest link. |
| 108 | Target Household flow | 🟡 PARTIAL | Spaces program delivers the mechanics; not packaged as a single guided household onboarding path. |
| 109 | Target Organization flow | 🟡 PARTIAL | Same as §108; org creation + capability roles exist; guided flow does not. |
| 110 | Target Settings experience (7 named groups with descriptions) | ❌ GAP | See §22. This is the single largest unbuilt user-facing piece. |
| 111 | Acceptance criteria | 🟡 PARTIAL | Architecture / existing-users / security / most UX criteria met or in-PR. **Not met:** Settings IA consolidation (§22), Billing/entitlements (§52), universal Add (§31), account-detail object (§16), F12 deletion/export. |
| 112 | Senior decision-making authority; reuse over rewrite | 📋 PROCESS | This audit + the "build the delta, don't re-implement" recommendation is the exercise of it. |
| 113 | Implementation philosophy (smallest coherent architecture) | 📋 PROCESS | — |
| 114 | Required final review (product / architecture / security / reliability / UX / commercial / quality) | 🟡 PARTIAL | Per-program reviews done; a consolidated review awaits the stack landing. |
| 115 | Final implementation report | ⏸️ DEFERRED | Produced per-PR in memory + `docs/oneledger-consolidation-current-state-map.md §11`. A single onboarding-architecture report is pending implementation. |

---

## 2. Consolidated gap list (what this prompt adds beyond shipped + in-PR work)

| # | Gap | Prompt §§ | Size | Notes |
| --- | --- | --- | --- | --- |
| G1 | **Settings IA restructure into 7 named groups** with descriptions + redirects from old paths; fold "Shared accounts" into "Spaces & Members"; merge the two Security rows | §6, §22–§28, §30, §61, §93, §110 | L | Planned in consolidation map Release 2, **not built** in `#128`. Largest user-facing gap. |
| G2 | **Billing & Plan surface + centralized entitlements domain** (schema + gate checks, no payment processing) | §29, §52, §53 | L | `ONELEDGER_PLATFORM_ASSESSMENT.md` §6.6 "Phase 3" — not started. |
| G3 | **Account-detail as a first-class object** with Overview / Transactions / Connections / Rules / Access / Settings tabs | §16, §24 | M | Connections management is still global-only. |
| G4 | **Onboarding-funnel analytics module** (`onboarding_started` … `first_transaction_received` … `setup_assistant_completed`) + events catalog doc | §54, §55, §104 | M | Milestone data model exists (`#122`); no event emission. Follow the `web/lib/spaces/analytics.ts` pattern. |
| G5 | **Setup review screen** (§19) as a distinct "Your OneLedger setup ✓ / Set up later" step | §19, §107 | S | Currently only a journey list on `/get-started`. |
| G6 | **F12 — account deletion / data export / retention** workstream | §94, §95 | L | Needs a retention-window product decision + cascade migration. Own workstream. |
| G7 | **Universal `+ Add` interaction** | §31 | M | Prompt-optional; only if it doesn't clash with the Pay action. |
| G8 | **Named e2e scenarios B / D / E / F / G** (defer-connection, org, interrupted setup, connection failure, existing-user migration) | §97 | M | A/C partially covered. |
| G9 | **F13 — `next/font/google` offline-build breakage** | §65 | S | `web/app/layout.tsx:3`. |
| G10 | **Email / PDF statement ingestion** as Connection types | §5, §14 | L | Only device capture + CSV import today. Likely out of scope for this slice. |
| G11 | **Country → currency / provider recommendation map** | §81 | S | Editable defaults exist; the recommendation table does not. |
| G12 | **In-context Activity read-model ADR** | §43 | S | Documentation/architecture only. |

## 3. Recommended sequencing (if/when implementation is authorized)

1. **Unblock the stack first** — regenerate `#128` visual baselines (user step),
   land `#128` → `#122` → `#127`. This alone closes or advances §9–§20, §32,
   §35–§36, §55, §74–§75, §89, §92.
2. **G1 (Settings IA)** as a dedicated PR on top of the landed stack — it depends
   on `#128`'s `navigation.ts` + `MORE_GROUPS` and the `ds/` primitives.
3. **G4 + G5** (analytics + review screen) — small, ride on the `#122` milestone
   model.
4. **G2 (entitlements)** as its own program phase per the assessment — schema +
   gate checks, dark, no payments.
5. **G3, G6–G12** individually prioritized with the product owner.

## 4. Do-not-regress list (inherited)

Non-custodial boundary (ADR 0001); integer minor units + currency; RLS as the
tenant boundary; Workspace/Membership separation; person-owned sources + explicit
Space visibility (ADR 0005); revocable per-connection credentials + rotation on
re-pair; raw-evidence provenance retention; conservative dedup (exact reject /
fuzzy review); provider-neutral connector adapter (ADR 0007); `navigation.ts` as
the single nav source of truth; structured redacted logging.
