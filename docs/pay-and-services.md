# Pay & Services - Phase 1: Verified USSD Hub

What shipped, how it's wired, and how to operate it. This documents the
system as built. Scope is **Phase 1 only** - a verified, administratively
maintained USSD/services directory plus the persistent global **Pay**
action and launcher shell. No money movement, no provider APIs, no
custody (see `docs/adr/0001-non-custodial-boundary.md`).

## Where each piece lives

| Concern | Location |
|---|---|
| Schema, RLS, admin RPCs | `supabase/migrations/20260906000000_phase_m_ussd_directory.sql` |
| Curated Rwanda seed (unverified) | `supabase/migrations/20260906000100_phase_m_ussd_seed.sql` |
| Migration/RLS/state-machine tests | `supabase/migrations/tests/run_migration_tests.sh` (the "Phase M" block) |
| Capability layer (dialer detection, `tel:` build, template fill, redaction) | `web/lib/ussd/capability.ts` (+ `capability_test.ts`) |
| Feature gating | `web/lib/pay/gate.ts` |
| Platform-admin check | `web/lib/pay/admin.ts` |
| RLS-scoped directory reads | `web/lib/ussd/queries.ts`, `web/lib/ussd/categories.ts` |
| Admin reads | `web/lib/ussd/admin-queries.ts` |
| User actions (favourite, usage, report, launcher snapshot) | `web/app/pay/actions.ts` |
| Admin actions (upsert, state change, report triage) | `web/app/admin/ussd/actions.ts` |
| Global Pay action + launcher | `web/components/pay/*` (mounted once in `web/components/AppShell.tsx`, gated by `payEnabled` from `web/app/layout.tsx`) |
| Directory browse / detail UI | `web/app/pay/ussd/**`, `web/components/ussd/*` |
| Admin UI | `web/app/admin/ussd/**`, `web/components/ussd/ServiceCodeAdminForm.tsx` etc. |
| UI chrome strings (translation-ready) | `web/lib/ussd/messages.ts` |
| e2e | `web/e2e/pay-ussd.spec.ts` |

## Launcher shell UX

`web/components/pay/PayLauncher.tsx` is a bottom sheet on mobile and a
centred dialog on desktop. Full modal semantics: focus moves into the
panel on open, Tab is trapped, background scroll is locked, focus is
restored to the trigger on close.

The panel is a three-part column — a static header, a single
`overflow-y-auto` content region, and a **pinned footer** that stays put
while the content scrolls. The footer holds the one closing control: a
centred X + "Close" (`aria-label` "Close Pay & Services", `min-h-11`,
`focus-visible` background) with `env(safe-area-inset-bottom)` padding so
it clears the home indicator. There is deliberately no header close
action — a long favourites / recent list must never push the way out
off-screen.

Every dismissal path — the footer control, the dimmed overlay, `Esc`,
and a navigation that closes the sheet — runs through one guarded
`requestClose()` so a double activation can't fire `onClose` twice.

## Scan to pay (Phase R1)

`SCAN_TO_PAY_ENABLED=true` (opt-in, off otherwise — same convention as
`SMS_RECONCILIATION_ENABLED`) adds a **"Scan to pay"** entry at the top
of the launcher. It swaps the sheet body for a camera scanner
(`web/components/pay/ScanToPay.tsx`, `lazy`-loaded so no camera/decoder
code is in the initial bundle). The header shows a Back control; the
pinned footer close stays.

**R1 is the camera shell only.** It opens the rear camera
(`facingMode: environment`, retried unconstrained on `OverconstrainedError`),
shows a live preview + viewfinder + an `aria-live` status line, and
offers a torch toggle where `getCapabilities().torch` is present. It
does **not** decode a QR code, parse a payload, or hand off to any
payment channel — the on-screen notice says so, and later phases add
that behind their own flags.

Guarantees:

- `getUserMedia` is called only from `ScanToPay`, i.e. only after an
  explicit "Scan to pay" tap (the component is lazy-mounted by that tap).
  Never on app start or when the sheet merely opens.
- The `MediaStream` is released on unmount, on error, when the tab is
  hidden (`visibilitychange`), and whenever a fresh start supersedes an
  in-flight one (a monotonic start token).
- Every failure is a distinct, actionable state: permission `denied` vs
  `dismissed` (told apart via the Permissions API where available),
  `noCamera`, `inUse`, `insecure` context, `unsupported` browser,
  `generic`. A browser-level denial is never described as an app bug.

| Concern | Location |
|---|---|
| Feature gate | `isScanToPayEnabled` / `assertScanToPayEnabled` in `web/lib/pay/gate.ts` |
| Wiring | `web/app/layout.tsx` → `web/components/AppShell.tsx` → `web/components/pay/PayProvider.tsx` → `PayLauncher` |
| Scanner | `web/components/pay/ScanToPay.tsx` |
| Privacy-safe events (no payload/PII ever) | `web/lib/pay/scan-analytics.ts` (+ `scan-analytics_test.ts`) |
| e2e | `web/e2e/pay-scan.spec.ts` (skipped unless `SCAN_TO_PAY_ENABLED=true` + a fake camera — see the file header) |

## Data model

Global (not workspace-scoped) directory content, plus per-user tables:

- `service_providers` - MTN, Airtel, banks, utilities, government agencies.
- `service_codes` - one versioned USSD route. Localized `*_en` / `*_rw`
  columns; `ussd_template` (literal `*182#` or parameterised
  `*182*1*1*{phone}*{amount}#`); provenance (`official_source_*`,
  `verified_at`, `verified_by`, `review_due_at`); publication `state` +
  `effective_from/to`; `replacement_code_id`; `risk_text` / `caution_text`;
  `version`.
- `service_code_parameters` - the safe input schema for a parameterised
  code (kind, required, `format_regex`, length bounds, localized hints).
- `service_code_steps` - ordered human-readable fallback instructions.
- `service_code_versions` - append-only snapshot per material change.
- `service_directory_audit_events` - admin action audit trail.
- `service_code_reports` - user "this code is wrong" reports; insert is
  rate-limited (<=5 open per user per rolling hour) by a BEFORE INSERT
  trigger.
- `service_favourites`, `service_recent_usage` - per-user, RLS-scoped to
  the owner. `service_recent_usage` is schema-constrained to hold only
  which code + an action/outcome enum - never a phone number, amount, or
  filled USSD string.

`profiles.is_platform_admin` (new column) gates the admin surface.

### Publication state machine

`admin_set_service_code_state()` enforces:

```
draft ─▶ pending_review ─▶ published
                 └─▶ draft
published ─▶ temporarily_unavailable ─▶ published
published ─▶ deprecated ─▶ published
temporarily_unavailable ─▶ deprecated
* ─▶ archived
```

Anything else raises `invalid_transition`. Non-admins only ever SELECT
`state = 'published'` rows inside `[effective_from, effective_to)` (RLS);
admins see every state.

## Gating

`web/lib/pay/gate.ts`, mirroring the existing `REPORT_*_ENABLED`
convention (a value is "on" unless it is exactly `"false"`):

- `PAY_SERVICES_ENABLED` - master switch (global Pay action, launcher, USSD).
- `USSD_DIRECTORY_ENABLED` - the directory specifically.
- `PAY_SERVICES_WORKSPACE_ALLOWLIST` - optional CSV of workspace ids for a
  staged beta; empty = everyone.

Enforced server-side in **every** action and query (`assertPayServicesEnabled` /
`assertUssdDirectoryEnabled`), and threaded to `AppShell` as a boolean so
the Pay action doesn't render when off. Disabling a flag blocks the
backend, not just a button. The admin RPCs additionally re-check
`is_platform_admin()` inside Postgres.

## Admin USSD verify & publish procedure

1. A platform admin (`profiles.is_platform_admin = true`, set manually by
   an existing operator) opens **`/admin/ussd`**.
2. **New service code** → fill provider, slug, category, English (and
   optionally Kinyarwanda) name/description, the USSD template, supported
   networks, the official source URL + label, a review-due date, and any
   caution/risk text. Add parameter rows for each `{placeholder}` and
   fallback steps. Save → creates the row in `draft`, writes a `v1`
   snapshot and an audit event.
3. Verify the template and prerequisites against the provider's own
   published documentation. When confirmed, tick **"Mark verified against
   the official source"** and save - this stamps `verified_at` /
   `verified_by`. Until then the UI shows a **"Not officially verified"**
   badge everywhere the code appears.
4. Move the state: **draft → pending_review → published** using the state
   controls (a reason is optional and recorded). `draft → published`
   directly is rejected.
5. Ongoing: the admin queue surfaces drafts, pending-review items,
   **re-verification due** codes (past `review_due_at`), and open user
   reports. Resolve a report with **reviewing / resolved / dismissed** and
   an optional note.
6. To retire a code: **published → deprecated** (optionally set
   `replacement_code_id` first so the detail page links users forward),
   or **→ temporarily_unavailable** for a transient outage, or
   **→ archived** to hide it entirely.

## Seed data & the verification gap

**Deliberate deviation from the master prompt.** The prompt says do not
seed an unverified list as authoritative. At the project owner's explicit
direction, `20260906000100_phase_m_ussd_seed.sql` seeds a curated
common-knowledge Rwanda set (MTN MoMo, Airtel Money, Bank of Kigali, RRA,
Irembo) as `state = 'published'` so the directory is useful immediately -
**but honestly**: `verified_at IS NULL`, `official_source_label =
'Community-compiled - pending official verification'`, `review_due_at` 14
days out, `caution_text` set on the money-movement codes, and a visible
**"Not officially verified"** badge on every such row. An admin is
expected to verify each entry against the provider's documentation and
stamp `verified_at`. Treat the seed as a starting worklist, not a
finished directory.

## USSD & device handling

`web/lib/ussd/capability.ts` is the single capability layer:

- `detectDialerCapability(userAgent)` - only iOS / Android lead with an
  **Open phone dialer** action; desktop and unknown platforms get
  **Copy code** + written steps + "Dialing isn't available on this
  device".
- `fillUssdTemplate()` - substitutes `{key}` placeholders with values
  validated against the parameter's `format_regex` (falling back to a
  per-kind default) and length bounds; **rejects any value containing
  `* # { }` or whitespace** (no USSD-path injection); reports an unknown
  placeholder rather than dropping it.
- `buildTelHref()` - encodes `#` as `%23`, leaves `*` and digits literal.
  Only ever called with a fully-filled string, only on a direct user
  gesture (a `tel:` `<a>`), never on load.
- `redactUssdForAnalytics()` - every `{key}` becomes `<kind>` so no user
  value can reach an analytics payload.

## Decisions & deviations (Phase 1)

| Area | Decision |
|---|---|
| Scope | Phase 1 only. Assisted Quick Pay (payment intents, drafts, trusted recipients, templates, Pay again, SMS-to-intent reconciliation) and provider adapters are later engagements. The launcher's payment actions render **disabled with a "coming later" hint** - never a fake success. |
| i18n | Translation-ready, **no framework**. Directory content has `*_en` / `*_rw` columns; UI chrome strings live in a typed `messages.ts` structured for later extraction. No `next-intl`, no locale routing, no switcher yet. `rw` falls back to `en`. |
| Feature flags | Env kill-switch + optional per-workspace allowlist (above). No general-purpose flag system was built. |
| Seed data | Curated-but-unverified, published with a visible badge (above). |
| QR desktop→phone hand-off | Deferred. Phase 1 desktop path is Copy code + written steps. |
| Down migrations | The repo has no down-migration convention; the migration is written to be reviewable and its objects are all `DROP`-able (`drop table ... cascade` for the 9 tables, `drop function` for the 6 functions, `alter table public.profiles drop column is_platform_admin`). |

## Phase 2a — Assisted Quick Pay

Makes the launcher's six payment actions real. **Still non-custodial**
(ADR 0001): an assisted flow *prepares and hands off* an instruction and
tracks the attempt — it never initiates a provider payment, never writes
the `transactions` ledger, never stores a PIN/OTP/secret. Delivered as
**2a** only; **2b** (SMS-to-intent reconciliation + ledger linking) is a
follow-up — the `payment_reconciliations` table already ships (schema
only) so 2b is purely additive.

### Where each piece lives (2a)

| Concern | Location |
|---|---|
| Schema, RLS, state-machine RPCs | `supabase/migrations/20260907000000_phase_n_payment_orchestration.sql` |
| Migration tests | `run_migration_tests.sh` ("Phase N" block) |
| Phone normalize / mask / provider-guess | `web/lib/pay/phone.ts` (+ `_test.ts`) |
| Intent state machine + honest status vocabulary | `web/lib/pay/state.ts` (+ `_test.ts`) |
| Minimal QR encoder (byte mode, auto version) | `web/lib/pay/qr.ts` (+ `_test.ts`), rendered by `web/components/pay/PaymentQr.tsx` |
| RLS-scoped reads + `isSessionFresh()` + lazy expiry | `web/lib/pay/intents.ts` |
| Gating | `web/lib/pay/gate.ts` (`isAssistedPayEnabled` / `isPaymentTemplatesEnabled` / `isTrustedRecipientsEnabled`) |
| Server actions | `web/app/pay/assisted-actions.ts` |
| Draft form / review+status / activity / recipients / templates | `web/app/pay/new/[type]/**`, `web/app/pay/[id]/**`, `web/app/pay/activity/**`, `web/app/pay/recipients/**`, `web/app/pay/templates/**` + `web/components/pay/*` |
| Stale-intent expiry cron | `web/app/api/cron/expire-payment-intents/route.ts`; pg_cron activation `supabase/scheduling/activate_payment_intent_expiry.sql` (manual, deferred) |
| e2e | `web/e2e/pay-assisted.spec.ts` |

### Data model (2a)

`trusted_recipients`, `payment_templates` (with an `enforce_no_payment_secret`
trigger that rejects any `recipient_snapshot` key in
`pin/otp/password/secret/credential`), `payment_intents` (unique
`(workspace_id, idempotency_key)`), `payment_attempts` (method + capability
outcome only — no msisdn/amount/filled USSD), `payment_events`
(append-only lifecycle log), `payment_reconciliations` (**schema only**,
2b), `payment_audit_events` (config-change trail). All workspace-scoped,
RLS via `is_workspace_member()`. Intents + their child rows are
**read-only** to `authenticated`; every write goes through a
`SECURITY DEFINER` RPC.

### Intent lifecycle & the "manually confirmed ≠ verified" principle

See **ADR 0002**. `successful` is unreachable by a plain user transition.
In 2a it is reached only via **`manually_confirm_payment`**, which stamps
`manually_confirmed_at` and leaves `verified_at` NULL — the UI shows
**"Manually confirmed"** with a neutral tone. `verified_at` (and a green
"Verified") comes only from 2b reconciliation.

| `state` (+ flags) | Label | Tone |
|---|---|---|
| `draft` | Draft | neutral |
| `initiated` / `awaiting_verification` | Awaiting verification | neutral |
| `successful` + `manually_confirmed_at` | **Manually confirmed** | **neutral** |
| `successful` + `verified_at` (2b) | Verified | positive |
| `failed` / `reversed` / `expired` / `requires_reconciliation` | (that word) | attention |
| `cancelled` | Cancelled | neutral |

### Hand-off

The review screen (`/pay/[id]`) reuses the Phase 1 capability layer. When
the intent links a published `service_code` (send-money codes resolved
server-side by provider + `intent='send_money'`), it fills the template
client-side from the stored msisdn (local `07…` form) + amount — the
filled string is never persisted (only the `<kind>`-redacted template is).
Mobile → **Open phone dialer**; desktop → **Copy code** + **Show QR**
(inline SVG, no network, `currentColor`, theme-aware — encodes a phone
number + amount, never a PIN). Every gesture records a `payment_attempt`
and moves the intent to `awaiting_verification`. A standing notice states
that authorization happens with the provider and OneLedger never asks for
the PIN.

### Session freshness

`isSessionFresh()` compares the Supabase session's issued-at against
`PAYMENT_SESSION_FRESHNESS_MINUTES` (default 60). Phase 2a **never
blocks** on it — a stale session only shows an advisory notice on the
review screen. A password-reentry step-up gate is deferred to Phase 3
(where real provider initiation lands).

### Decisions & deviations (2a)

| Area | Decision |
|---|---|
| Scope | 2a only. SMS reconciliation / ledger linking / `payment_reconciliations` population / the ingest-momo hook / provider adapters / real initiation / `processing`/`verified`/`reversed` transitions are 2b or later. |
| Step-up auth | Session-freshness **soft notice** only; no password re-entry (Phase 3). |
| QR hand-off | **Included** (per product-owner decision) — a from-scratch, dependency-free encoder (`web/lib/pay/qr.ts`). Structurally unit-tested; a real-phone scan is part of manual verification. Copy is always the primary path. |
| Expiry | Route + lazy UI view now; pg_cron activation deferred to a manual scheduling file (same pattern as the report scheduler). |
| Feature flags | Env kill-switches + the shared workspace allowlist. |

## Phase 2b — SMS reconciliation & ledger linking

Closes the 2a loop: when the Mobile Money SMS for a handed-off payment is
ingested and becomes a `transactions` row, **deterministically link that
row to its intent** and advance the intent to `verified` — **without ever
creating a second ledger transaction**. See **ADR 0003**.

### Where each piece lives (2b)

| Concern | Location |
|---|---|
| Schema (columns on `payment_reconciliations`), matcher RPCs, resolution RPCs | `supabase/migrations/20260908000000_phase_o_sms_reconciliation.sql` |
| Pure rule reference (unit-tested) | `supabase/functions/_shared/payment-reconciliation.ts` (+ `tests/`) |
| Ingest hook (best-effort, opt-in, non-fatal) | `supabase/functions/ingest-momo/index.ts` (after "MARK RAW MESSAGE AS PROCESSED") |
| On-handoff match | `web/app/pay/assisted-actions.ts#recordHandoff` (service-role client, gated) |
| Retry cron | `web/app/api/cron/reconcile-pending-payments/route.ts`; pg_cron `supabase/scheduling/activate_payment_reconciliation.sql` (manual, deferred) |
| Gating | `web/lib/pay/gate.ts` (`isSmsReconciliationEnabled` — **opt-in**, `smsReconciliationMode`) |
| Reads + queue + manual-link picker | `web/lib/pay/intents.ts` |
| Resolution actions | `web/app/pay/assisted-actions.ts` (`applyReconciliation` / `rejectReconciliation` / `linkPaymentManually`) |
| UI | `web/components/pay/PaymentIntentPanel.tsx` (linked / likely-match / manual-link sections), `web/app/pay/reconciliation/**`, the "Prepared with OneLedger Pay" note on `web/app/transactions/[id]/page.tsx` |
| e2e | `web/e2e/pay-reconciliation.spec.ts` |

### Reconciliation priority ladder

1. Authenticated provider status + reference *(Phase 3)*
2. Verified provider callback + independent confirmation *(Phase 3)*
3. **Deterministic SMS receipt match** *(this phase)*
4. User manual confirmation — explicitly labelled "Manually confirmed", `verified_at` NULL *(2a)*
5. Probabilistic suggestion requiring review *(not built — deterministic only)*

### Deterministic match (all must hold)

workspace · `direction='out'` + `status='success'` + `currency='RWF'` ·
`amount_minor == amount_rwf` · normalized recipient MSISDN
(`normalize_rw_msisdn`) · provider ↔ `transactions.source` ·
`occurred_at ∈ [intent.created_at − 10min, coalesce(intent.expires_at,
+24h)]` · the intent is `initiated`/`awaiting_verification` and unlinked ·
the transaction has no existing `linked` reconciliation.

- **1 candidate →** `payment_reconciliations` row `status='linked'`. In
  `apply` mode: intent → `successful`, `linked_transaction_id` +
  `verified_at` set, category applied as a **review-queue suggestion**
  (never over an `auto`/`provisional`/`confirmed`/`manual` decision). In
  `observe` mode: the row is written with `applied_at IS NULL` and
  nothing else changes.
- **≥ 2 candidates →** one `status='conflict'` row per candidate; in
  `apply` mode each intent → `requires_reconciliation`. Never a guess.
- **0 →** nothing written.

Idempotent: a second reconcile call for the same transaction is a no-op
(`already_linked`); the partial-unique indexes on `payment_reconciliations`
(`one linked intent`, `one linked txn`) are the backstop.

### Rollout: observe → apply

1. Set `SMS_RECONCILIATION_ENABLED=true` + `SMS_RECONCILIATION_MODE=observe`
   in Vercel prod **and** as Supabase edge-function secrets
   (`supabase secrets set …`).
2. Watch `/pay/reconciliation` — every deterministic match shows as a
   likely-match candidate. Confirm accuracy on real traffic.
3. Flip `SMS_RECONCILIATION_MODE=apply` (both places). Matches now link +
   verify automatically; the retry cron
   (`activate_payment_reconciliation.sql`) can be activated.

### Conflict / manual resolution

`/pay/reconciliation` lists unapplied candidates (Apply / Reject) and
`requires_reconciliation` intents. On a single intent's `/pay/[id]`, a
**"Link an existing transaction"** picker (`getUnlinkedRecentTransactions`)
lets the user link the right ledger row directly (`match_method='manual'`,
applied immediately).

## Phase P — Payment networks, access routes & directory permissions

Extends the Phase 1 directory to represent an **interoperable payment
network** (eKash) and adds a **granular `directory.*` permission system**.
See `docs/pay-services-phase-p-design.md` and
`docs/adr/0004-payment-networks-and-directory-permissions.md`. Delivered
as four staged PRs; **PR 1 (schema + permissions + RPCs + seed) is the
DB foundation — no UI yet.**

### Where each piece lives (P1 — schema)

| Concern | Location |
|---|---|
| Schema, RLS, `has_directory_permission()`, admin RPCs | `supabase/migrations/20260909000000_phase_p_payment_networks.sql` |
| Verified eKash network-level seed (+ 2 draft institution examples) | `supabase/migrations/20260909000100_phase_p_payment_networks_seed.sql` |
| Migration/RLS/permission/state-machine tests | `run_migration_tests.sh` ("Phase P" block) |

### Where each piece lives (P2 — admin UI)

| Concern | Location |
|---|---|
| App-side permission mirror (`getDirectoryAccess` / `assertDirectoryPermission`) | `web/lib/pay/directory-perms.ts` (+ client-safe `directory-permission-list.ts`) |
| Admin reads (dashboard, lists, edit detail, evidence, versions) | `web/lib/directory/admin-queries.ts` |
| Grant-management reads (needs `auth.users` → service role, platform-admin only) | `web/lib/directory/permissions-admin.ts` |
| Server actions wrapping every RPC | `web/app/admin/directory/actions.ts` |
| Directory Management dashboard + queues | `web/app/admin/directory/page.tsx` |
| Payment Networks (list / new / edit + operators + network fees/limits + aliases + evidence + versions) | `web/app/admin/directory/networks/**`, `web/components/directory/PaymentNetworkForm.tsx`, `NetworkExtrasPanel.tsx` |
| Institutions & Providers + participation (list / new / edit) | `web/app/admin/directory/institutions/**`, `web/components/directory/ParticipationForm.tsx` |
| Access Routes (list / new / edit + flows + menu steps + fees + limits) | `web/app/admin/directory/routes/**`, `web/components/directory/AccessRouteForm.tsx` |
| Sources & Authorities (regulators, operators, verification sources) | `web/app/admin/directory/sources/page.tsx`, `web/components/directory/ReferenceEntityForms.tsx` |
| Verification evidence panel (attach/detach, private) | `web/components/directory/EvidencePanel.tsx` |
| Evidence file download (signed URL, re-checks `directory.view_evidence`) | `web/app/api/admin/directory/evidence/[id]/route.ts` |
| `directory.*` grant admin (platform-admin only) | `web/app/admin/directory/permissions/page.tsx`, `web/components/directory/PermissionGrantsPanel.tsx` |
| Shared publication state control | `web/components/directory/DirectoryStateControls.tsx` |
| UI authorization-gate e2e | `web/e2e/admin-directory.spec.ts` |

Reached at **`/admin/directory`** (linked from the Phase M `/admin/ussd`
page). A holder of any `directory.*` grant — or a platform admin — sees
the read-only surface; each action button is shown only when the caller
holds the matching permission, and the RPC re-checks server-side. RPC
behaviour (state machine, PIN-parameter rejection, evidence visibility,
maker–checker) is covered by the `run_migration_tests.sh` "Phase P"
block; the Playwright spec only guards the UI gate (the e2e user is not
an admin), matching how `/admin/ussd` is covered.

### Where each piece lives (P3 — public eKash experience)

| Concern | Location |
|---|---|
| Route favourites / recent / reports on an `access_route` (not just a `service_code`) | `supabase/migrations/20260909000200_phase_p_route_favourites.sql` |
| RLS-scoped public reads (network overview, route finder, route result, network search by alias) | `web/lib/directory/public-queries.ts` (+ client-safe `public-types.ts`) |
| Fee / limit phrasing (`none` / `unknown` / `varies by institution` / `published maximum`) | `web/lib/directory/format.ts` |
| Per-user actions (favourite / usage / report a route) | `web/app/pay/networks/actions.ts` |
| Network overview page | `web/app/pay/networks/[slug]/page.tsx`, `web/components/directory/public/NetworkOverview.tsx` |
| Route finder (guided, URL-driven) + results | `web/app/pay/networks/[slug]/routes/page.tsx`, `web/components/directory/public/RouteFinder.tsx` |
| Route result (verified code / entry point, ordered steps, fees, limits, verification source, copy/dial, save, report) | `web/app/pay/networks/[slug]/routes/[routeId]/page.tsx`, `web/components/directory/public/RouteResultPanel.tsx` |
| Directory search surfaces the network (canonical + `eCash` / `RSwitch` aliases) | `web/app/pay/ussd/page.tsx` (new "Payment networks" section) |
| UI chrome strings | `web/lib/ussd/messages.ts` (`network` block) |
| e2e | `web/e2e/pay-networks.spec.ts` |

The route result reuses the Phase 1 capability layer: a linked
**non-parameterised** USSD code gets **Copy** + **Open phone dialer**
(mobile) or **Copy** + written steps (desktop); a **parameterised** code
or an approved entry-point label is shown as guidance to complete on the
user's own phone — never auto-dialled, never with a PIN. When no verified
route exists for the chosen combination the finder shows an honest empty
state ("OneLedger hasn't verified… we won't guess") rather than inventing
instructions.

### Where each piece lives (P4 — suggestions, jobs, flags)

| Concern | Location |
|---|---|
| `directory_suggestions` table + rate-limit trigger + `admin_resolve_directory_suggestion` RPC | `supabase/migrations/20260909000300_phase_p_directory_suggestions.sql` |
| Migration tests | `run_migration_tests.sh` "Phase P" block (suggestion cases; counters 97→99 grants / 47→48 fns / 59→60 RLS tables) |
| User suggestion intake (`/pay/suggest`) | `web/app/pay/suggest/**`, `web/components/directory/SuggestForm.tsx` |
| Moderation queue + repeated-report aggregation | `web/app/admin/directory/suggestions/page.tsx`, `web/components/directory/SuggestionModerationPanel.tsx`, `web/lib/directory/suggestions.ts` |
| Verification-freshness sweep (read-only — never unpublishes) | `web/app/api/cron/directory-verification-sweep/route.ts`; pg_cron activation `supabase/scheduling/activate_directory_verification_sweep.sql` (manual, deferred) |
| Privacy-conscious event sink (PII-stripping, no provider wired) | `web/lib/directory/analytics.ts` (+ `_test.ts`) |
| Feature flags | `web/lib/pay/gate.ts` — `PAYMENT_NETWORKS_ENABLED`, `DIRECTORY_ADMIN_ENABLED` (on unless `"false"`), `DIRECTORY_SUGGESTIONS_ENABLED` (**opt-in**, off unless `"true"`) |

**Suggestions never auto-publish.** A submission is a `directory_suggestions`
row (rate-limited to ≤5 open per user per rolling hour, reporter-scoped
RLS, a cheap client + server guard against PIN/OTP/account numbers in the
body). Its status is only ever advanced by
`admin_resolve_directory_suggestion` (`directory.resolve_reports`-gated),
which records who/when/why, can link the record + version it fed into,
and writes an audit event — it publishes nothing itself. Repeated reports
are surfaced as a **visibility signal** (count of open reports per entry),
explicitly *not* treated as verification.

**The sweep is read-only.** `/api/cron/directory-verification-sweep`
counts review-due published entries + entries with ≥3 unresolved reports,
writes one `directory.verification_sweep` audit row when there's a
signal, and returns the digest. It **never unpublishes** — the admin
decides. Not yet scheduled (same manual pg_cron pattern as the other
cron routes). Cache refresh after a publication-state change is handled
inline by the admin actions' `revalidatePath` calls.

**Analytics.** No analytics provider is wired in this codebase;
`service_recent_usage` (schema-constrained to no PII) is the durable
code/route usage store. `lib/directory/analytics.ts` is the single sink a
provider would attach to, and it hard-strips forbidden keys
(phone/account/meter/merchant/amount/reference/pin/otp/…) and
identifier-shaped string values before anything could leave the process
(`analytics_test.ts` covers the redaction). Wired at directory search and
route-finder-no-result (server) and suggestion-submitted (action).

### Data model (P1)

`payment_networks` (own 6-state publication lifecycle), `regulatory_authorities`
("regulated by"), `service_operators` + `payment_network_operators`
(versioned "operated by"), `institution_network_participation` (versioned,
per-institution, independently verified), `access_routes` (institution-
specific, channel-typed, may reference a `service_codes` USSD entry) with
`route_supported_flows` / `route_menu_steps` / `route_fees` / `route_limits`
(fees & limits carry a `scope = network | institution`; institution rows
override network rows in the read layer; `fee_type` distinguishes
`none` / `unknown` / `varies_by_institution` / `published_maximum`),
`directory_sources` + `directory_evidence` (private `directory-evidence`
Storage bucket, no `authenticated` file-byte access — signed URL only),
`directory_aliases` (search-normalised alternate spellings),
`directory_versions` (generic append-only history), `directory_role_grants`
(the 14 `directory.*` permissions).

### Permissions & maker–checker (P1)

`has_directory_permission(perm)` is the authorization primitive for every
Phase P RLS policy and admin RPC. **`is_platform_admin()` implies all 14
`directory.*` permissions** (Platform Owner fallback) — so the current
single-operator setup, the Phase M seed, and the Phase M tests are
behaviourally unchanged. The state-transition RPCs check a **different**
permission per transition (`draft→pending_review` = `directory.submit_review`;
`pending_review→published` = `directory.review` **and** `directory.publish`),
so narrowing grants later enforces maker–checker with no schema change.
The Phase M RPCs are re-issued with `has_directory_permission()` guards.

### Seed & the verification gap (P1)

The eKash **network-level** record is seeded `state='published'`,
`verified_at` set, with provenance (`official_source_label =
'RSwitch Ltd - official system-operator publication'`) — canonical name,
`entity_type='interoperable_network'`, BNR as regulator, RSwitch as
current system operator, the RWF 20 **published-maximum** fee
(`route_fees.fee_type='published_maximum'`), the RWF 10,000,000
**published-maximum** per-transaction capacity
(`route_limits.is_published_maximum`), the 14 July 2026 full-
interoperability date, and `eKash` / `eCash` / `RSwitch` aliases.
**No `access_routes` or `route_menu_steps` are seeded** — the RSwitch
notice contains no bank USSD codes or menu option numbers, and the brief
(§5) forbids inventing them; they are added per institution with separate
verified evidence. Bank of Kigali and MTN Rwanda participation rows are
seeded `state='draft'`, `verified_at IS NULL` purely to give the P2/P3
UI realistic "not yet verified" rows.

## Support troubleshooting

- **"Dialing isn't available on this device."** Expected on desktop and
  some handsets. Use **Copy code** and dial on the phone, or follow the
  numbered steps. Not an error.
- **A user reports a wrong code.** It lands in `/admin/ussd` → open
  reports. Verify against the provider, edit the code (new version +
  audit), resolve the report. Consider **→ temporarily_unavailable**
  while investigating.
- **A code stopped working / provider changed the menu.** Set
  **→ deprecated** with a `replacement_code_id`, or
  **→ temporarily_unavailable**. Never leave a known-broken code
  `published` without a caution.
- **Pending payments / unmatched SMS / reversals / duplicates.** Not
  applicable in Phase 1 - no payments are initiated. These belong to
  Phase 2's Assisted Quick Pay.

## Production enablement checklist (before any later phase moves money)

- [ ] Provider onboarding + commercial agreement (MTN / Airtel / bank / PSP).
- [ ] Compliance assessment against Rwanda data-protection and
      payment-services obligations - documented, not assumed from the
      presence of technical controls.
- [ ] Security review of the provider adapter, callback authentication,
      and secret handling.
- [ ] A superseding ADR for any custody / balance / disbursement change.
- [ ] The server-side production gate (feature flag + capability) stays
      **off** until every box above is checked.
