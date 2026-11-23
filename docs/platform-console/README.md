# OneLedger Platform Console

Operations console for OneLedger staff, destined for `https://platform.oneledger.me`.
Code: [`platform/`](../../platform) · Database: [`supabase/migrations/20270120000000_platform_console_foundation.sql`](../../supabase/migrations/20270120000000_platform_console_foundation.sql)

Status date: 2026-11-19. Branch: `claude/oneledger-platform-console-ca8ff5`. **Nothing here is deployed.**

---

## 1. What was built in this slice

Phase 0 (audit + foundation) and Phase 1 (shell + Executive Dashboard) of the master spec, plus three
small modules that fall out of the data already available.

| Area | Route | What it does |
|---|---|---|
| Sign-in | `/login` | Email + password via Supabase Auth. One generic error for every failure. |
| MFA | `/mfa` | TOTP enrolment/challenge. **Required**: the database refuses every console RPC below `aal2`. |
| Executive Dashboard | `/dashboard` | KPI strip, Platform Activity table, Activity Intelligence chart + observation, Revenue Calendar, Subscription Distribution, Executive Action Queue. 7/30/90-day range. |
| System Health | `/platform/health` | The existing aggregate operational-health snapshot, behind a console permission. |
| Audit Logs | `/security/audit-logs` | Paged, append-only audit trail. Opening it is itself audited. |
| Access Management | `/security/access` | **Read-only** staff directory + your own permissions. |
| Users | `/customers/users` | Customer directory, metadata only (masked ref, name, assigned plan, registered, last activity timestamp, status). Search, status filter, keyset paging; reads are audited. Needs `view_customer_metadata`. Migration `20270120000001`. |

Everything else in the navigation is shown as a non-interactive **Soon** entry. No control in the console is decorative.

## 1a. v2 (2026-11-19): design system, shell and data-backed pages

Migration `20270121000000` (6 more read RPCs; harness tripwires now 143 tables / 154 authenticated functions) and a rebuilt UI:

- **Design system v2** (`platform/app/globals.css`): AA-checked light theme, refined dark theme, user toggle (cookie, no flash), navy sidebar, status "ink" colours, chart palette, focus ring. Components: Card, KpiCard (+sparkline), StatusPill, Tabs, Segmented, DataTable, Pager, Skeleton, Unavailable/Empty/Error states, ColumnChart, ShareBars, Funnel.
- **Shell**: grouped icon sidebar with active bar, mobile drawer, breadcrumb, sticky header, working **⌘K command palette** (pages + customer lookup, 3+ chars, same permission/masking as Users).
- **New pages**: Activity Center (`/overview/activity`), Reports & Intelligence (`/overview/reports`: monthly registrations, activation funnel, workspace types, plan mix), Registrations (`/customers/registrations`: derived state pending verification / incomplete / verified / restricted), Organizations (`/customers/organizations`), Security Center (`/security`: staff MFA coverage, denials, audited actions, customer sign-in ledger), Customer detail (`/customers/users/[id]`: metadata only).
- Still **Soon** (need a data source or product decision): Customer Support, all Revenue pages, Incidents, Integrations, Communications, Feature Management, Configuration, Approvals, Administrative Actions.

## 1b. v3 (2026-11-20): workflows

Migration `20270123000000` (18 functions, 5 tables; harness tripwires now 148 tables / 172 authenticated functions, 1097 checks):

- **Customer Support** (`/customers/support`): staff-logged tickets (no customer intake exists), categories, priority, status machine, assignment, escalation (note required), append-only timeline, internal notes.
- **Incidents** (`/security/incidents`): declare, severity, honest detection source, status machine (resolve needs a note), containment entries, append-only timeline.
- **Approvals** (`/administration/approvals`) and **Administrative Actions** (`/administration/actions`): four-eyes staff access changes (grant, suspend, reactivate, role change). Requester != approver, nobody decides a request about their own access, one pending request per change, approval applies the change and writes the audit row in the same transaction, a failed re-validation is recorded as `failed`, the last active Platform Owner cannot be suspended or demoted.
- **Integrations** and **Communications**: read-only counts. No endpoints, secrets, recipients or message text.

Write rules: one SECURITY DEFINER function per command, `console_assert` first, rows locked (`FOR UPDATE`) so a double submit is a no-op or a clear error, free-text bodies never copied into audit metadata, append-only tables immutable even for `service_role`.

**Bootstrap note:** with one Platform Owner nobody can approve the owner's own requests, so the second `manage_staff` holder must be seeded by SQL once. After that, access changes go through Approvals.

**Finding F6 (not fixed here):** customers have table-level UPDATE on `profiles` with an own-row policy, and only `is_platform_admin` is guarded. `profiles.status` (`active`/`suspended`) is therefore customer-writable, so a customer-suspend action in the console would not be enforceable. Customer suspend/restore is deliberately not built until `status` is protected the same way.

## 1c. Billing (2026-11-23)

Design: [billing-design.md](billing-design.md). Migration `20270124000000` (5 tables, 16 functions; harness 153 tables / 198 authenticated functions, 1212 checks). Pages: `/revenue/subscriptions` (+ detail), `/revenue/billing`, `/revenue/analytics`, `/revenue/refunds`.

A **staff-run ledger**: no provider is integrated, nothing moves money, and `workspace_plans` (entitlements) is never touched. Prices are fixed by a check constraint (yearly = monthly x 12, no discount); a payment's amount is derived from the plan, never supplied; payments are idempotent on `(provider, reference)`; initiation is separate from settlement; refunds are four-eyes (Finance Administrator only, never the requester, never the Platform Owner) with a payout reference, capped at the payment. MRR/ARR are labelled estimates, kept apart from collected cash.

## 2. Repository audit (Part III)

| # | Question | Finding |
|---|---|---|
| 1 | Frontend framework | Next.js 16.3.1, React 19.2.8, Tailwind 4, TypeScript. `web/AGENTS.md` warns Next 16 differs from training data: `proxy.ts` (not `middleware.ts`), async `cookies()`. The console follows `web/proxy.ts`. |
| 2 | Layout | `web/` (customer app), `supabase/` (149+ migrations, 8 edge functions), `oneledger-mobile/` (Expo), `android/` (legacy). No monorepo tooling; each app has its own `package.json`. |
| 3 | Auth | Supabase Auth + `@supabase/ssr` cookie sessions; `proxy.ts` refreshes the session. TOTP MFA exists in the customer app (`MfaManager`). |
| 4 | Users / orgs | `profiles` (1:1 `auth.users`, has `status active/suspended`), `workspaces`, memberships. Tenancy via RLS (`20260821…`). |
| 5 | Existing admin roles | **One boolean: `profiles.is_platform_admin`** (added `20260906…`, used by directory/USSD admin RPCs and `/admin/*`). Not role-aware, not MFA-gated. See finding F1. |
| 6 | Billing architecture | **None for OneLedger's own subscriptions.** No subscription, invoice or payment-collection tables. See F2. |
| 7 | Plans | `workspace_plans.plan ∈ {free, personal_plus, household, business}`, "writes are system/admin only — there is no self-serve billing". Tier→entitlement map in `web/lib/entitlements/plans.ts`. **Not** the Personal/VIP/Business RWF tiers in the spec. |
| 8 | Payment providers | MTN MoMo (inbound SMS/email parsing of *customers'* own transactions) and payment *orchestration* for customers paying third parties. Neither collects OneLedger subscription revenue. |
| 9 | Supabase schema | 140 public tables, all RLS-enabled except `auth_login_attempts`. Harness tripwires enforce counts. |
| 10 | RLS | Per-workspace via `is_workspace_member()`. Admin surfaces use `SECURITY DEFINER` RPCs guarded by `is_platform_admin()`. |
| 11 | Edge functions / jobs | `capture`, `ingest-momo`, `process-raw-events`, `reconcile-balances`, `send-notifications`, `send-push-notifications`, `inbound-email`; 17 `/api/cron/*` routes (pg_cron + shared secret). |
| 12 | Audit logging | Per-domain, append-only tables: `space_audit_events`, `payment_audit_events`, `service_directory_audit_events`. No platform-staff audit trail before this work. |
| 13 | Notifications | Resend email + Expo push + in-app. Customer-facing; no operator notification channel. |
| 14 | Analytics | `get_operational_health_snapshot` (service-role only, exposed via an operator-secret route). No product analytics tables. |
| 15 | Support | **None.** No tickets, conversations or support tables. |
| 16 | Admin UIs | `/admin/directory`, `/admin/ussd` (inside the customer app, gated by `is_platform_admin`). |
| 17 | Env vars | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (+ service-role for ingestion/cron in `web/`). The console needs **only** the two public ones. |
| 18 | Vercel | `web/` deploys via the Vercel CLI only (Git integration off — see `deploy-topology` notes). `vercel.json`: region `lhr1`. No console project yet. **`platform.oneledger.me` routing not verified** — requires Vercel/Hostinger access this session did not use. |
| 19 | Shared UI | Customer-app components are product-specific. Tokens in `web/app/globals.css` were reused by value; no code is shared. |
| 20 | API/auth boundaries | Customer app trusts session + RLS; service-role confined to ingestion/cron. The console keeps the same shape and goes further: **no service-role key at all**. |

### Findings

- **F1 — `profiles.is_platform_admin` is too weak to gate a console.** It is a lone boolean, and on `origin/main` it is **user-writable** through the ordinary profile update path. The hardening branch `fix/protect-platform-admin-flag` (`6abe3cc`, `d7279a8`, migration `20270106000001`) is **not merged**. The console therefore does *not* use the flag. **Recommend merging that branch regardless**: it closes a self-promotion path on the existing `/admin/*` and directory RPCs.
- **F2 — No subscription billing exists.** Parts IX–XI (subscriptions, billing, refunds, revenue analytics) have no data source. They are **Blocked**, not mocked. Building them needs a product decision first (see §7).
- **F3 — Plan model mismatch.** The spec's Personal/VIP/Business (RWF 2,500/5,000/10,000 monthly) does not match the stored tiers. The console shows stored tiers, labelled as *assigned*, never as paying subscribers. `plans.ts` was not touched.
- **F4 — No support, incident or approval tables.** Parts XII, XIII (incidents), XX are Planned.
- **F5 — Concurrent work.** Worktrees exist for `codex/phase1-foundation` (main checkout, uncommitted mobile changes), `fix/protect-platform-admin-flag`, `feat/provider-tariffs`, `test/household-two-accounts`. This work touches **no file under `web/`, `oneledger-mobile/` or `android/`**.

## 3. Architecture

```
staff browser ── https ──▶ platform/ (Next 16, own Vercel project)
                              │  proxy.ts: refresh session, redirect signed-out
                              │  (console)/layout: requireSession() = user + staff + aal2
                              ▼
                      Supabase (same project, anon key + staff's own JWT)
                              │  console_* SECURITY DEFINER RPCs
                              ▼
                 console_assert(permission): uid ∧ aal2 ∧ active staff ∧ permission
```

Decisions:

1. **Separate app/deployable** (`platform/`), own `package.json`, same Supabase project (no second DB or auth provider).
2. **No service-role key in the console.** Cross-tenant reads happen only inside permission-guarded `SECURITY DEFINER` RPCs that return **aggregates and masked ids** — never transaction rows, descriptions, amounts or balances. A compromised console session can read what the RPCs return and nothing else.
3. **Authorization lives in the database.** `console_assert()` is the boundary; app checks (`can()`, nav filtering) are UX. A role table (`console_role_permissions`) is the single source of truth, delivered via `console_my_access()`.
4. **MFA is enforced by the database** (`auth.jwt()->>'aal' = 'aal2'`), not by routing.
5. **No in-console privilege management.** Staff are granted by a DB operator. A console that can grant itself privilege is an escalation path; this is deliberate until dual-approval exists.
6. **Append-only audit.** `UPDATE/DELETE/TRUNCATE` rejected by trigger, including for `service_role`. Actor and role are derived from the session, never from arguments. Opening the audit log and staff directory is audited.
7. **Honest data states.** Where no source exists the UI says so ("Not connected", "Unknown", "Soon"). `insufficient_data` health is shown as *Unknown*, never *Operational*.
8. **Hardening headers** on every route: `X-Frame-Options: DENY`, strict CSP `frame-ancestors`, `no-store`, `noindex`, `no-referrer`, HSTS.

### Metric definitions (shown in the UI too)

- **Registered customers** — rows in `profiles`. *New* = `created_at` within the selected range; delta compares to the equal-length range before it. Delta against a zero baseline shows no percentage.
- **Active workspace** — a workspace with ≥1 transaction *recorded* (`transactions.created_at`) in the range.
- **Plan distribution** — `workspace_plans.plan` as currently assigned. Not paying subscribers.
- **Platform health** — `assessOperationalHealth()` (copied from `web/lib/operational-health.ts`; keep thresholds in sync) over a 60-minute snapshot.

## 4. Role and permission matrix

Source of truth: `console_role_permissions` (seeded in the migration). ✔ = held.

| Permission | Owner | Admin | Finance | Security | Support | Analyst |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| view_aggregate_metrics | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| view_customer_metadata | ✔ | ✔ | | | ✔ | |
| view_financial_metrics | ✔ | | ✔ | | | ✔ |
| view_audit_logs | ✔ | ✔ | | ✔ | | |
| view_staff | ✔ | ✔ | | ✔ | | |
| manage_staff | ✔ | | | | | |
| view_system_health | ✔ | ✔ | | ✔ | | ✔ |
| review_security_incidents | ✔ | | | ✔ | | |
| manage_subscriptions | ✔ | ✔ | ✔ | | | |
| manage_support_tickets | ✔ | ✔ | | | ✔ | |
| configure_integrations | ✔ | ✔ | | | | |
| approve_refunds | | | ✔ | | | |
| export_sensitive_reports | | | | | | |

`export_sensitive_reports` is deliberately held by **no** role yet, and the Owner holds neither it nor `approve_refunds`: seniority does not bypass privacy or money controls. Only `view_aggregate_metrics`, `view_audit_logs`, `view_staff` and `view_system_health` are enforced by an RPC today; the rest are reserved for modules not yet built.

## 5. Runbook

### Environment (Vercel project for `platform/`)

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Same as the customer app |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Same as the customer app |

No service-role key. No other secrets.

### Local

```bash
cd platform && npm install
NEXT_PUBLIC_SUPABASE_URL=… NEXT_PUBLIC_SUPABASE_ANON_KEY=… npm run dev   # http://localhost:3100
npm run typecheck && npm run lint && npm test
```

### Seeding the first Platform Owner (database operator only)

Apply migration `20270120000000` through the normal pipeline (`deploy-supabase.yml` on a green `main`), then, in the SQL editor / with the service role:

```sql
insert into public.console_staff (user_id, role, notes)
select id, 'platform_owner', 'initial owner'
from auth.users where email = 'OWNER@EXAMPLE.COM';
```

The owner signs in at `/login`, enrols an authenticator at `/mfa`, and lands on the dashboard. To suspend someone: `update public.console_staff set status = 'suspended' where user_id = …` — takes effect on their next request.

### Deploying (not done in this session)

1. Create a **separate Vercel project** with root directory `platform/`; add the two env vars; keep preview deployments protected.
2. Attach `platform.oneledger.me` and verify the Hostinger DNS record resolves to that project (currently unverified).
3. Merge `fix/protect-platform-admin-flag`, then migration `20270120000000` (version chosen to sort after the Codex range `20270107`–`20270111` already applied to prod; re-run the harness on merged `main` first — see the migration-collision notes).
4. Seed the owner, smoke-test: signed-out → `/login`; non-staff → `/no-access`; staff without MFA → `/mfa`; staff with MFA → dashboard.
5. Rollback: re-point the domain / redeploy the previous Vercel deployment. The migration is additive; rollback is `drop` of the 3 tables and 7 functions (no customer data is touched).

## 6. Verification status (Part XXIX vocabulary)

| Deliverable | Status |
|---|---|
| 1 Repository audit | **Implemented and verified** (§2; findings checked against code) |
| 2 Architecture specification | **Implemented and verified** (§3) |
| 3 UI/UX reference analysis | **Blocked** — the three reference screenshots did not arrive, only the written description. Layout follows Part II's text (sidebar, header, KPI strip, table + panel, three bottom modules). **Visual comparison not performed.** |
| 4 Navigation / IA | **Implemented and verified** (`lib/console/nav.ts` + unit tests; unbuilt = "Soon") |
| 5 Design system | **Partially implemented** — tokens, Card, KpiCard, StatusPill, DataTable, Segmented, EmptyState/ErrorState/Unavailable, BarChart, Shell. Missing: drawer, confirm dialog, filter popover, date-range picker, permission-gate component, skeletons, export control. |
| 6 Executive dashboard | **Implemented, not verified against a live signed-in session** (typechecks, builds, gate verified; RPCs verified in SQL; never rendered with real data — see §8) |
| 7 Customer administration | **Partially implemented** — user directory only (SQL-verified, not rendered live); detail drawer, registrations oversight and account actions Planned |
| 8 Subscription management | **Blocked** (F2/F3) |
| 9 Financial operations | **Blocked** (F2) |
| 10 Customer support | **Planned** (F4) |
| 11 Security & access | **Partially implemented** — audit log, read-only staff directory, MFA gate. Incidents, role editing, dual approval: Planned. |
| 12 Platform monitoring | **Partially implemented** — pipeline health only. Availability/latency/deploy health: no telemetry source (Planned). |
| 13 Approval workflow | **Planned** |
| 14 API & DB docs | **Implemented and verified** (migration header, §3–4) |
| 15 Role/permission matrix | **Implemented and verified** (§4, enforced + tested in SQL) |
| 16 Automated test results | **Implemented and verified** — see §8 |
| 17 Security review | **Partially implemented** — see §7 below; no external review, no pen-test |
| 18 Deployment guide | **Implemented, not verified** (§5, steps not executed) |
| 19 Production readiness | **Not ready** — see §7 |
| 20 Codex coordination | **Implemented and verified** (§9) |

## 7. Security review and open risks

Verified by tests: non-staff/suspended/aal1 denied; permissions not disclosed at aal1; per-permission denial; audit actor derived from session; audit immutable (even for `service_role`); no direct table access for `authenticated`; `console_assert` not callable by clients; no self-grant path.

Open before production:

1. **Not deployed, not run against a real project.** The only end-to-end runs are SQL harness + unauthenticated HTTP smoke.
2. **Password-only first factor**, no per-account lockout in the console (Supabase rate limits apply; the customer app's `auth_login_attempts` lockout is not wired in). Failed sign-ins are not audited.
3. **Denials are audited only for active staff** (and only after the app catches `not_authorized`): a rolled-back transaction cannot persist its own audit row.
4. **No IP allow-listing / device posture**; consider Vercel firewall rules for the domain.
5. **Session lifetime** is Supabase's default; set a short JWT expiry / inactivity timeout for the project if the same Supabase project's customer settings allow it.
6. **Platform Owner ≠ DB superuser**: whoever seeds `console_staff` can mint an owner. Restrict service-role access and log it outside the app.
7. Rwanda data-protection review of retention/disclosure rules (Part XXIV) **not done**; no export path exists, so nothing is exportable yet.

## 8. Test results (this branch)

- `supabase/migrations/tests/run_migration_tests.sh` (Homebrew PG17, full chain applied twice): **1040 passed, 0 failed** (tripwires now 143 tables / 154 authenticated functions). Added: tripwires (+3 tables, +7 authenticated functions) and a 34-assertion "Platform Console" block. The block caught two real defects before this was written up: `service_role` inheriting UPDATE/DELETE on the audit table via default privileges (fixed with an explicit `revoke`), and a test-helper capture bug.
- `platform`: `npm run typecheck` clean · `npm run lint` clean · `npm test` 8/8 · `next build` succeeds · unauthenticated `curl` of `/dashboard`, `/security/audit-logs`, `/platform/health`, `/mfa` → 307 `/login`; headers present on `/login`.
- **Not done:** signed-in browser walkthrough (no Supabase project/credentials were used), accessibility audit (axe), responsive/mobile check, performance measurement, comparison with the reference screenshots.

## 9. Coordination with Codex / other sessions

- Touched: `platform/**`, `docs/platform-console/**`, one new migration, `supabase/migrations/tests/run_migration_tests.sh` (tripwire counts + a new appended test block).
- Not touched: `web/**`, `oneledger-mobile/**`, `android/**`, shared auth, `plans.ts`.
- **Migration ordering:** `20270120000000` assumes `20270106000001` (platform-admin flag hardening) lands first or never; it does not depend on it.
- **Harness counts:** any concurrent migration that adds tables/authenticated functions must also bump the tripwires (`TABLE_COUNT` 143, authenticated EXECUTE 147 after this change) — expect a trivial merge conflict in those lines.
- Shared backend asks for Codex/product: a subscription-billing data model (F2), support/ticket tables (F4), and a decision on the plan taxonomy (F3).

## 10. Next slices (recommended order)

1. Merge `fix/protect-platform-admin-flag`; deploy migration; seed owner; walk the console end-to-end with MFA (closes the "not verified" gaps).
2. Customers: user directory + registrations from `profiles`/`workspaces` (metadata only, masked), with detail drawer — no new data source needed.
3. Decide the billing model (F2/F3); then Subscriptions → Billing → Reconciliation/Refunds with idempotent, dual-approved commands.
4. Approvals + staff management (grant/suspend) behind dual approval.
5. Support tickets and security incidents (new tables).
6. Design-system gaps (drawer, confirm dialog, skeletons) and an axe + mobile pass.
