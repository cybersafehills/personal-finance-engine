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
