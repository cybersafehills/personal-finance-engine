# Pay & Services — Phase P: Payment Networks, Access Routes & Granular Directory Permissions

**Status:** P1–P4 implemented on this branch (all four staged PRs). `run_migration_tests.sh` → **151 passed / 0 failed**; `next build` / `tsc` / `eslint` / `deno test` clean.

- **P1** — migration + seed + "Phase P" migration-test block.
- **P2** — the `/admin/directory` admin UI.
- **P3** — public eKash network page + route finder + route result + alias search; `20260909000200` (favourite/recent/report an `access_route`).
- **P4** — `directory_suggestions` + moderation queue (`/admin/directory/suggestions`), the `/pay/suggest` intake (opt-in flag), the read-only verification-freshness sweep cron + deferred pg_cron activation, the PII-stripping analytics sink, and the `PAYMENT_NETWORKS_ENABLED` / `DIRECTORY_ADMIN_ENABLED` / `DIRECTORY_SUGGESTIONS_ENABLED` flags.
**Branch:** `feat/pay-services-phase-p-payment-networks`
**Builds on:** Phase M (USSD directory), ADR 0001 (non-custodial), ADR 0002/0003 (payment lifecycle & reconciliation).
**Source brief:** `OneLedger_USSD_Directory_eKash_Administration_Implementation_Prompt.md`.

This is the first of four staged PRs:

| PR | Scope |
|----|-------|
| **P1 (this doc)** | Schema + granular `directory.*` permission system + admin RPCs + eKash network-level seed (+ 2 draft institution examples) + migration-test coverage. **No UI.** |
| P2 | Admin UI: Payment Networks, Financial Institutions & Providers, Access Routes, Verification Evidence, Directory Management dashboard + queues. |
| P3 | Public UI: eKash network page, route finder, route result, search aliases, favourites/copy/dial reuse. |
| P4 | User suggestions & error-report intake (moderation queue), verification-freshness background jobs, privacy-conscious analytics events, feature-flag wiring for staged rollout. |

---

## 1. What already exists (Phase M) and what P1 adds

Phase M (`20260906000000_phase_m_ussd_directory.sql`) already delivers, and P1 **keeps unchanged**:

- `service_providers`, `service_codes` (versioned, 6-state publication machine, provenance, `effective_from/to`, `replacement_code_id`), `service_code_parameters`, `service_code_steps`, `service_code_versions`, `service_directory_audit_events`, `service_code_reports` (rate-limited), `service_favourites`, `service_recent_usage`.
- Admin RPCs `admin_upsert_service_code`, `admin_set_service_code_state`, `admin_resolve_service_code_report`.
- `profiles.is_platform_admin` + `is_platform_admin()` SECURITY DEFINER.
- Capability layer `web/lib/ussd/capability.ts` (dialer detect, `tel:` build, template fill with `* # { }` / whitespace rejection, analytics redaction).

P1 **adds** the entities the brief calls for that have no equivalent today: payment networks, their regulatory authority / system operator relationships, versioned institution participation, institution-specific access routes (distinct from a bare USSD code), per-route transfer flows / menu steps / fees / limits, verification sources & evidence (with a private Storage bucket), search aliases, a generic version/audit trail for the new entity types, and a **granular `directory.*` permission system** that supersedes the binary `is_platform_admin` gate for the directory surface.

P1 **modifies** (via `create or replace` / `alter table ... add column if not exists`, all reversible):

- `service_directory_audit_events` — add nullable `subject_type` / `subject_id` so it records network / participation / route / operator actions too (existing `service_code_id` column kept for back-compat).
- `admin_upsert_service_code` / `admin_set_service_code_state` / `admin_resolve_service_code_report` — swap the `is_platform_admin()`-only guard for `has_directory_permission('directory.<verb>')`. `is_platform_admin()` still implies **every** `directory.*` permission (Platform Owner fallback, brief §8), so existing behaviour, seed, and Phase M tests are unaffected.
- `service_providers` — add nullable `regulatory_authority_id`, `emoney_issuer boolean not null default false`.

---

## 2. Permission model (brief §9) — `directory.*`

### 2.1 `directory_permissions` (the 14 slugs)

Not a table — a `text` + `CHECK` domain used everywhere, matching the repo's "enum-likes are text + CHECK" rule:

```
directory.view_admin      directory.create          directory.edit_draft
directory.submit_review    directory.review          directory.publish
directory.suspend          directory.deprecate        directory.archive
directory.restore          directory.view_evidence    directory.manage_evidence
directory.view_audit       directory.resolve_reports
```

### 2.2 `directory_role_grants`

```sql
create table public.directory_role_grants (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  permission  text not null check (permission in ( ...the 14 slugs... )),
  granted_by  uuid references auth.users(id) on delete set null,
  granted_at  timestamptz not null default now(),
  note        text,
  constraint directory_role_grants_unique unique (user_id, permission)
);
```

- RLS: a user sees their own grant rows; a holder of `directory.view_admin` sees all. No `authenticated` write path — grants are made only through `admin_grant_directory_permission` / `admin_revoke_directory_permission`, which require `is_platform_admin()` (bootstrap authority) and write an audit row.
- No workspace scoping — the directory is global platform content (Phase M established this), so directory permissions are platform-level, orthogonal to `workspace_memberships.role`. An **organization admin gets nothing here automatically** (brief §9).

### 2.3 `has_directory_permission(perm text) returns boolean`

SECURITY DEFINER, STABLE, `search_path = public`. Mirrors `is_workspace_member`'s shape.

```sql
select public.is_platform_admin()
    or exists (select 1 from public.directory_role_grants
               where user_id = auth.uid() and permission = perm);
```

`grant execute ... to authenticated, service_role`. Used by every new RLS policy and every new/replaced admin RPC.

### 2.4 Maker–checker

The state-transition RPC checks a **different** permission per transition (see §4.2), so one grantee holding only `directory.create` + `directory.edit_draft` + `directory.submit_review` genuinely cannot publish. A Platform Owner with `is_platform_admin` can still do everything (fallback). Authoring vs verification are always written as separate audit rows regardless of who performed them, so separation can be *enforced* later purely by narrowing grants — no schema change (brief §8).

---

## 3. New tables

All follow repo conventions: `uuid` pk `default gen_random_uuid()`; `timestamptz` + `set_updated_at()` trigger on mutable rows; `text` + `CHECK`, never PG enums; RLS on every table; `anon` fully revoked; `authenticated` granted only the verbs it uses (directory-content tables: `select` only — writes via RPC); every function gets its own explicit `grant execute`.

Publication lifecycle columns, identical semantics to `service_codes`, appear on `payment_networks`, `institution_network_participation`, `access_routes`:

```
state text not null default 'draft' check (state in
  ('draft','pending_review','published','temporarily_unavailable','deprecated','archived'))
effective_from timestamptz not null default now()
effective_to   timestamptz            -- CHECK (effective_to is null or effective_to > effective_from)
version        integer  not null default 1  check (version >= 1)
verified_at timestamptz   verified_by uuid   review_due_at timestamptz
official_source_url text   official_source_label text
created_by uuid   created_at   updated_at
```

### 3.1 `regulatory_authorities`
`id, slug unique, name, country char(2) default 'RW', website_url, notes, created_at, updated_at`.
Reference data. RLS: readable by any `authenticated` (non-sensitive; names of regulators are public). Write via `admin_upsert_regulatory_authority` (`directory.create` / `directory.edit_draft`).
Seed: **National Bank of Rwanda** (`bnr`).

### 3.2 `service_operators`
Same shape as `regulatory_authorities`. Network / system operators.
Seed: **RSwitch Ltd** (`rswitch`).

### 3.3 `payment_networks`
```
id, slug unique, canonical_name,
display_name_en, display_name_rw, description_en, description_rw,
entity_type text check (entity_type in
  ('interoperable_network','card_scheme','mobile_money_scheme','other')),
country char(2) default 'RW',
regulatory_authority_id uuid references regulatory_authorities on delete set null,
full_interoperability_effective_date date,
separate_registration_required boolean,   -- nullable: null = unknown
separate_app_required boolean,
access_channel_summary_en / _rw text,
custody_note_en / _rw text,
+ publication lifecycle & provenance columns (§3 preamble)
```

Network-level **fee / capacity** are *not* columns — they live in `route_fees` / `route_limits` with `scope='network'` so the "published maximum vs guaranteed vs varies-by-institution" distinction (brief §5, §7) is expressible and versioned. This avoids re-modelling later.

Seed: **eKash** — `entity_type='interoperable_network'`, `regulatory_authority_id → bnr`, `full_interoperability_effective_date = 2026-07-14`, `separate_registration_required = false`, `separate_app_required = false`, `custody_note_en = "Customer funds remain in the customer's existing regulated bank account or mobile wallet."`, `access_channel_summary_en = "Existing USSD, mobile-banking apps, Mobile Money apps, and internet-banking services."`, `state='published'`, `verified_at = now()`, `official_source_label = "RSwitch Ltd — official system-operator publication"`, `review_due_at = now() + interval '180 days'`, `version = 1`.

### 3.4 `payment_network_operators` (versioned — brief §13 "one or more operators over time")
```
id, payment_network_id fk, service_operator_id fk,
operator_role text check (operator_role in ('system_operator','processor','switch','other')),
effective_from timestamptz not null default now(), effective_to timestamptz,
is_current boolean not null default true,
official_source_url, official_source_label, verified_at, verified_by,
created_by, created_at, updated_at
```
Partial unique: one `is_current` row per `(payment_network_id, operator_role)`.
Seed: eKash ↔ RSwitch, `operator_role='system_operator'`, `is_current=true`.

### 3.5 `institution_network_participation` (brief §5, §13 "explicit, versioned participation records")
```
id, provider_id fk service_providers, payment_network_id fk,
participant_role text check (participant_role in ('bank','emi','both','other')),
+ publication lifecycle & provenance columns
```
Partial unique: one non-archived, open-ended row per `(provider_id, payment_network_id)`.
**Not** auto-derived — a provider existing in the directory does **not** imply eKash participation (brief §5). Each row + each route carries its own `verified_at` / evidence.
Seed (both `state='draft'`, `verified_at = null`, `official_source_label = "Pending official verification"`):
- Bank of Kigali (`a0000000-…-a3`) ↔ eKash, `participant_role='bank'`.
- MTN Rwanda (`a0000000-…-a1`) ↔ eKash, `participant_role='emi'`.
These give P2/P3 non-empty admin rows and a realistic route-finder empty state ("participation not yet verified"). They are never published by the seed.

### 3.6 `access_routes` (brief §5 hierarchy, §11 route result)
```
id, slug unique,
provider_id fk service_providers,                 -- the institution exposing the route
payment_network_id fk on delete set null,          -- null = standalone service route (not network-bound)
participation_id fk institution_network_participation on delete set null,
channel text check (channel in
  ('ussd','mobile_app','internet_banking','provider_website','qr','other')),
service_code_id uuid references service_codes on delete set null,  -- a route MAY reference a USSD code
approved_entry_point_en text,     -- provider entry-point label when channel<>'ussd'
internet_required boolean not null default false,
device_compat text[] not null default '{}',
display_name_en/_rw, description_en/_rw, risk_text, caution_text,
replacement_route_id uuid references access_routes on delete set null,
+ publication lifecycle & provenance columns
```
`CHECK (service_code_id is not null OR approved_entry_point_en is not null)` — a route must resolve to *something* verifiable.
One USSD code can back many routes (brief §13). **No routes seeded** — the RSwitch notice has no bank USSD codes or option numbers, and §5 forbids inventing them.

### 3.7 `route_supported_flows`
`id, access_route_id fk (cascade), flow_type text check (flow_type in ('account_to_wallet','wallet_to_account','account_to_account','wallet_to_wallet','merchant_payment','other')), note_en`. Unique `(access_route_id, flow_type)`.

### 3.8 `route_menu_steps` (brief §7 "Ordered menu steps")
`id, access_route_id fk (cascade), position, action_label_en/_rw, instruction_en/_rw, expected_menu_label_en, expected_option_number text, parameter_key text, caution_en/_rw, channel_applicability text[], created_at`. Unique `(access_route_id, position)`. `expected_option_number` is `text` (menus use `1`, `1.2`, `#`…) and **nullable** — only set when verified. No step may reference a PIN/OTP/secret (enforced by the RPC's parameter-key allowlist, mirroring Phase M).

### 3.9 `route_fees` (brief §7 "Fees and limits" — nullable, not zero)
```
id,
scope text check (scope in ('network','institution')),
payment_network_id uuid references payment_networks on delete cascade,
access_route_id   uuid references access_routes   on delete cascade,
fee_type text check (fee_type in
  ('fixed','percentage','tiered','none','unknown','varies_by_institution','published_maximum')),
fixed_fee_minor bigint, percentage_bps integer,
min_fee_minor bigint, max_fee_minor bigint,
currency char(3) not null default 'RWF',
effective_from timestamptz not null default now(), effective_to timestamptz,
source_url, source_label, note_en,
created_by, created_at
constraint route_fees_scope_target check (
  (scope='network'     and payment_network_id is not null and access_route_id is null) or
  (scope='institution' and access_route_id   is not null and payment_network_id is null))
```
`fee_type` carries the semantic the brief demands — `none` ≠ `unknown` ≠ `varies_by_institution` ≠ `published_maximum` — instead of overloading `0`/`NULL`. Institution-scope rows override network-scope rows in the read layer (brief §13 "inherit from network, overridden by verified institution info").
Seed (network scope, eKash): `fee_type='published_maximum'`, `max_fee_minor = 20`, `currency='RWF'`, `note_en = "Published maximum per transaction. Participating institutions may determine applicable charges within this framework; this is not necessarily a fee charged by eKash."`.

### 3.10 `route_limits`
```
id, scope (same check), payment_network_id fk, access_route_id fk,
min_txn_minor bigint, max_txn_minor bigint, daily_limit_minor bigint,
currency char(3) default 'RWF',
is_published_maximum boolean not null default false,
institution_override boolean not null default false,
effective_from, effective_to, source_url, source_label, note_en, created_by, created_at
constraint route_limits_scope_target check ( ...same as route_fees... )
```
Seed (network scope, eKash): `max_txn_minor = 10000000`, `is_published_maximum = true`, `note_en = "Published platform per-transaction capability. Participating institutions may enforce lower per-transaction or daily limits under their own policies."`.

### 3.11 `directory_sources` (brief §7 verification evidence — the citation)
```
id, organization text not null, title text,
classification text check (classification in
  ('official_regulator','official_system_operator','official_financial_institution',
   'official_telecom_emoney','approved_internal_verification','community_suggestion_unverified')),
source_url text, publication_date date,
is_public boolean not null default false,
created_by, created_at, updated_at
```
RLS: `is_public` → any `authenticated`; otherwise `has_directory_permission('directory.view_evidence')`. Public pages may show `organization`, `title`, `publication_date`, and `source_url` **only when `is_public`** (brief §7 "keep source evidence private by default").
Seed: one row — `organization='RSwitch Ltd'`, `title='eKash interoperability public notice'`, `classification='official_system_operator'`, `is_public=true`.

### 3.12 `directory_evidence` (the uploaded artefact)
```
id, source_id fk directory_sources on delete restrict,
subject_type text check (subject_type in
  ('service_code','payment_network','network_operator','institution_participation','access_route')),
subject_id uuid not null,
storage_path text,          -- relative to the private 'directory-evidence' bucket
mime_type text, byte_size bigint check (byte_size is null or byte_size > 0), checksum text,
uploaded_by uuid, verified_by uuid, verification_date timestamptz,
next_review_date timestamptz,
internal_note text, public_caveat_en text,
is_public boolean not null default false,
created_at
```
- Private Storage bucket `directory-evidence` (`public = false`), created in-migration exactly like Phase K's `report-artifacts`. **No `storage.objects` policies for `anon`/`authenticated`** — default-deny. File bytes reach an admin only through a signed URL issued by a P2 route that first checks `directory.view_evidence` then uses the service-role client (same pattern as `app/api/reports/[id]/pdf/route.ts`).
- Table RLS: `select` for `has_directory_permission('directory.view_evidence')`; no `authenticated` write path (attach/detach via RPC, `directory.manage_evidence`).
- No `authenticated`/`anon` table grant at all (like `report_artifacts`).

### 3.13 `directory_aliases` (brief §12 — search normalisation)
```
id, alias text not null, normalized_alias text not null,
subject_type text check (subject_type in
  ('payment_network','service_code','service_provider','access_route')),
subject_id uuid not null,
is_primary boolean not null default false,
created_at
constraint directory_aliases_unique unique (normalized_alias, subject_type, subject_id)
```
Partial unique: one `is_primary` per `(subject_type, subject_id)`. `normalized_alias` = lower-cased, non-alphanumerics stripped (computed in the RPC; also a `normalize_directory_alias(text)` immutable helper so P3 search can normalise the query the same way).
RLS: an alias row is visible only if its subject is visible to the caller (per-`subject_type` `EXISTS` against the subject's own published/effective predicate, or `has_directory_permission('directory.view_admin')`). This keeps unpublished network/route names out of search.
Seed (subject = eKash network): `eKash` (`is_primary`), `e-Kash`, `eKash`, `eCash`, `e-Cash`, `RSwitch` → normalised `ekash`, `ekash`, `ekash`, `ecash`, `ecash`, `rswitch`. Deduped by the unique constraint.

### 3.14 `directory_versions` (generic append-only history for the new entities)
```
id, subject_type text check (subject_type in
  ('payment_network','network_operator','institution_participation','access_route')),
subject_id uuid not null, version integer not null check (version >= 1),
snapshot jsonb not null, change_reason text, changed_by uuid, created_at
constraint directory_versions_unique unique (subject_type, subject_id, version)
```
`service_codes` keeps its existing dedicated `service_code_versions` (unchanged). RLS: `has_directory_permission('directory.view_audit')`.

---

## 4. Admin RPCs

All `SECURITY DEFINER`, `set search_path = public`, each with its own `revoke all from public` + `grant execute ... to authenticated`. Each writes a `directory_versions` (or `service_code_versions`) snapshot **and** a `service_directory_audit_events` row. All raise `not_authorized` (`errcode insufficient_privilege`) when the permission check fails, `invalid_transition` / `check_violation` for bad state moves, `not_found` (`no_data_found`) for missing ids — matching Phase M/N/O error vocabulary so the existing `friendlyDbMessage` mapping in the server actions keeps working.

### 4.1 Upserts (permission: `directory.create` on insert, `directory.edit_draft` on update)

| RPC | Nested children it replaces atomically |
|-----|----------------------------------------|
| `admin_grant_directory_permission(p_user uuid, p_permission text, p_note text)` | — (guard: `is_platform_admin()`) |
| `admin_revoke_directory_permission(p_user uuid, p_permission text)` | — (guard: `is_platform_admin()`) |
| `admin_upsert_regulatory_authority(payload jsonb) → uuid` | — |
| `admin_upsert_service_operator(payload jsonb) → uuid` | — |
| `admin_upsert_payment_network(payload jsonb) → uuid` | `aliases[]` |
| `admin_upsert_network_operator(payload jsonb) → uuid` | closes prior `is_current` row for the role |
| `admin_upsert_institution_participation(payload jsonb) → uuid` | — |
| `admin_upsert_access_route(payload jsonb) → uuid` | `supported_flows[]`, `menu_steps[]`, `fees[]`, `limits[]` |
| `admin_upsert_directory_source(payload jsonb) → uuid` | — |
| `admin_attach_directory_evidence(payload jsonb) → uuid` (perm: `directory.manage_evidence`) | — |
| `admin_detach_directory_evidence(p_id uuid)` (perm: `directory.manage_evidence`) | — |

`admin_upsert_access_route` rejects any `menu_steps[].parameter_key` or nested input whose kind is in `pin/otp/password/secret/credential/security_answer/card_cvv` — same allowlist rule as Phase M/N, enforced in-function (brief §4, §7, §22.3).

### 4.2 State machine (one RPC per lifecycled entity)

`admin_set_payment_network_state(p_id, p_state, p_reason)`, `admin_set_participation_state(...)`, `admin_set_access_route_state(...)` — identical allowed-transition matrix to `admin_set_service_code_state`:

```
draft ─▶ pending_review ─▶ published
                 └─▶ draft
published ─▶ temporarily_unavailable ─▶ published
published ─▶ deprecated ─▶ published
temporarily_unavailable ─▶ deprecated
* ─▶ archived
```

Per-transition permission required (this is the maker–checker point):

| Transition | Permission |
|------------|-----------|
| `draft → pending_review` | `directory.submit_review` |
| `pending_review → draft` (changes requested) | `directory.review` |
| `pending_review → published` | `directory.review` **and** `directory.publish` |
| `published → temporarily_unavailable` | `directory.suspend` |
| `temporarily_unavailable → published` | `directory.restore` |
| `published → deprecated`, `temporarily_unavailable → deprecated` | `directory.deprecate` |
| `deprecated → published` | `directory.restore` |
| `* → archived` | `directory.archive` |

Deprecating a published entity requires a non-empty `p_reason` (brief §8 "public replacement explanation"). A material change to an already-published row via `admin_upsert_*` forces `state` back to `pending_review` and stamps a new `version` (brief §8); a metadata-only change (localised text) does not (mirrors Phase M's lightweight-review carve-out).

### 4.3 Existing Phase M RPCs — guard swap only

`admin_upsert_service_code` → `directory.create` / `directory.edit_draft`.
`admin_set_service_code_state` → the per-transition table above.
`admin_resolve_service_code_report` → `directory.resolve_reports`.
Bodies otherwise unchanged. `is_platform_admin()` implies all → **zero behaviour change for the current single-operator setup and the Phase M test block.**

---

## 5. RLS summary

| Table | `authenticated` (no directory grant) SELECT | Admin SELECT |
|-------|--------------------------------------------|--------------|
| `regulatory_authorities`, `service_operators` | all rows | all |
| `payment_networks` | `state='published'` ∧ in `[effective_from,effective_to)` | `directory.view_admin` → all |
| `payment_network_operators` | parent network visible ∧ (`is_current` ∨ in effect) | ″ |
| `institution_network_participation` | published ∧ in effect | ″ |
| `access_routes` | published ∧ in effect | ″ |
| `route_supported_flows` / `route_menu_steps` | parent route visible | ″ |
| `route_fees` / `route_limits` | (`scope='network'` ∧ network visible) ∨ (`scope='institution'` ∧ route visible) | ″ |
| `directory_aliases` | subject visible (per-type EXISTS) | `directory.view_admin` |
| `directory_sources` | `is_public` | `directory.view_evidence` |
| `directory_evidence` | — (no grant) | `directory.view_evidence` |
| `directory_versions` | — | `directory.view_audit` |
| `directory_role_grants` | own rows | `directory.view_admin` |

No `INSERT`/`UPDATE`/`DELETE` policy or grant for `authenticated` on any directory-content table — every write is an RPC (Phase M precedent). `service_role` keeps `grant all` everywhere.

---

## 6. Seed migration (`20260909000100_phase_p_payment_networks_seed.sql`)

Idempotent (`on conflict do nothing`, fixed UUIDs). Contents = everything marked "Seed:" above:

- `bnr` regulatory authority, `rswitch` service operator.
- `eKash` payment network — **published, verified against the supplied RSwitch notice**, provenance stamped.
- eKash ↔ RSwitch current `system_operator` row.
- eKash network-scope `route_fees` (`published_maximum`, RWF 20) and `route_limits` (RWF 10,000,000, `is_published_maximum`).
- One public `directory_sources` row for the notice.
- eKash aliases (`eKash` primary, `e-Kash`, `eCash`, `e-Cash`, `RSwitch`).
- **Draft, unverified** participation: Bank of Kigali (`bank`) and MTN Rwanda (`emi`) ↔ eKash.
- **No `access_routes`, no `route_menu_steps`** — deliberately (brief §5: the notice contains no bank USSD codes or option numbers; do not invent them). Recorded in the completion report as "records intentionally left unpublished due to missing evidence".

The `docs/pay-and-services.md` "Seed data & the verification gap" section gets a Phase P subsection making this explicit.

---

## 7. Migration-test coverage (`run_migration_tests.sh`, new "Phase P" block)

- Chain applies cleanly to an empty DB, twice, deterministically (existing A–I harness picks the new migrations up automatically).
- **Privilege counters updated** (the fragile hard-coded assertions):
  - `authenticated` table-grant count **`82 → 97`**: `select`-only grants on the 14 new public-readable tables (`directory_role_grants`, `regulatory_authorities`, `service_operators`, `payment_networks`, `payment_network_operators`, `institution_network_participation`, `access_routes`, `route_supported_flows`, `route_menu_steps`, `route_fees`, `route_limits`, `directory_sources`, `directory_aliases`, `directory_versions`) **plus** `directory_evidence` `select` (metadata only — RLS-gated to `directory.view_evidence`; the file bytes are served via a signed URL). = 15. The comment arithmetic block is extended in the Phase M/N/O style.
  - `authenticated` function-EXECUTE count **`29 → 47`**: `has_directory_permission`, `normalize_directory_alias`, the 2 bootstrap RPCs, the 11 upserts (`admin_upsert_regulatory_authority` / `_service_operator` / `_payment_network` / `_network_operator` / `_institution_participation` / `_access_route` / `_network_fee` / `_network_limit` / `_directory_source` / `admin_attach_directory_evidence` / `admin_detach_directory_evidence`), and the 3 state RPCs = 18. Internal helpers (`directory_transition_allowed`, `directory_transition_permission`, `record_directory_version`, `record_directory_audit`) and the `directory_aliases_set_normalized` trigger stay `revoke all from public`.
- New behavioural assertions (Phase P block):
  1. a plain user sees the published eKash network but **not** the draft BK/MTN participation rows;
  2. `has_directory_permission('directory.create')` is false for a plain user, true after `admin_grant_directory_permission`;
  3. a grantee with only `directory.create` can `admin_upsert_payment_network` (draft) but `admin_set_payment_network_state(..., 'published')` raises `not_authorized`;
  4. `draft → published` directly raises `invalid_transition`; `draft → pending_review → published` (with `directory.review`+`directory.publish`) succeeds and writes 2 `directory_versions` + 2 audit rows;
  5. `admin_upsert_access_route` with a `menu_steps[].parameter_key = 'pin'` raises;
  6. `directory_evidence` select returns 0 rows for a user without `directory.view_evidence`, rows for one with it;
  7. alias normalisation: `normalize_directory_alias('e-Kash!') = 'ekash'`; the unique constraint dedupes the seeded variants;
  8. re-running both Phase P migrations inserts nothing new (idempotent).

---

## 8. Non-custodial & accuracy guardrails carried into P1 (brief §4)

- No table stores, and no RPC parameter accepts, a PIN / OTP / password / secret / credential / security answer / card CVV. `admin_upsert_access_route` rejects those parameter kinds in-function.
- `route_menu_steps` final-step text may say "authorise with your provider's secure process" but the schema has no field that could hold a PIN prompt.
- eKash is modelled as a `payment_networks` row with participation + routes — **never** a single `service_codes` USSD entry. No universal eKash USSD code is seeded (brief §5, §11).
- `payment_networks.regulatory_authority_id` expresses "regulated by", `payment_network_operators` expresses "operated by" — distinct relationships (brief §13). Seed sets BNR as authority, RSwitch as operator; neither is described as the other.
- Every seeded participation row is `draft` + `verified_at IS NULL`; nothing marks an institution an eKash participant without its own evidence (brief §5).

---

## 9. Open questions / assumptions

1. **`official_source_url` for the eKash seed** — the supplied notice is a document, not a URL. Seed leaves `official_source_url = NULL` with `official_source_label = "RSwitch Ltd — official system-operator publication"`. If you have a public RSwitch URL for the notice, I'll add it.
2. **Minor units for RWF** — RWF is zero-decimal; the repo's existing seed treats amounts as whole RWF. P1 stores `*_minor` as whole RWF (fee `20`, capacity `10000000`) and documents the column as "minor units; RWF has no subunit so = whole RWF". Flag if you'd rather a `currency_scale` column.
3. **Assumed** the two draft example institutions (BK, MTN) are acceptable as *unverified drafts* purely to exercise P2/P3 UI. They will not be published until real evidence is entered.
4. **Assumed** `directory.*` grants are made by hand by a Platform Owner (via the two bootstrap RPCs) — no self-serve grant UI in P1; a minimal grant admin screen can be part of P2.
