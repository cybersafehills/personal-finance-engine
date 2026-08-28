# OneLedger Spaces — Shared Household Ledger & Multi-User Financial Collaboration

Design of record for the Spaces program. This is a foundational upgrade to
OneLedger's ownership, authorization, ingestion, and reporting model, first
exposed publicly as **Household** collaboration but architected so a future
**Business** context needs no new tenancy system.

Companion decision record: **ADR 0005** (household as a third
`workspaces.kind`; source visibility is explicit, never conferred by
membership). Read that first — this document elaborates it into schema,
pipeline, and a phase plan.

---

## 1. What already exists, and what Spaces adds

The prompt's "OneLedger Spaces" is ~two-thirds built already, under the
name **`workspaces`**. Spaces reuses it wholesale.

### Already in place (reused as-is)

| Concern | Where |
|---|---|
| Unified tenancy container `workspaces(kind, status, default_currency, timezone)` | `20260821000000_phase_b_identity_and_tenancy.sql` |
| `workspace_memberships(role owner\|admin\|member\|viewer, status invited\|active\|suspended\|removed)`, `removed_at` retained | Phase B |
| `is_workspace_member(ws_id, min_role)` — SECURITY DEFINER / STABLE authz primitive every scoped RLS policy composes with | Phase B, extended Phase C |
| Auto personal workspace + owner membership at signup (`handle_new_user`) | Phase B |
| Existing-user backfill `user_id → workspace_id` on accounts / transactions / merchant_rules | `20260821000100_phase_b_ownership_backfill_and_constraints.sql` |
| Org workspace creation, **bearer-token hashed invites** (`workspace_invites`, `invite_preview`, `accept_workspace_invite`), `set_member_role` / `remove_member` with **last-owner guard** | `20260827000000_organization_workspaces.sql` |
| Active-workspace resolution: `active_workspace_id` httpOnly cookie + `getActiveWorkspaceId()` with safe fallback to personal on revoked membership | `web/lib/queries.ts` |
| `WorkspaceSwitcher`, `/settings/workspace`, `/invite/[token]`, `CreateInviteForm`, `MemberItem`, `InviteItem` | `web/components/`, `web/app/` |
| Multi-account + per-device ingestion: `accounts` (`is_primary`, `archived_at`), `ingestion_connections` (credential-hash, DB-enforced same-workspace binding, provider enum), `transactions.ingestion_connection_id` provenance | Phase C |
| Budgets & goals, workspace-scoped: `budgets`, `budget_allocations`, `budget_category_mappings`, `goal_contributions`, `budget-math.ts` + alerts + tests | Phase D |
| Categorization policy engine + history + learned suggestions, workspace-scoped | Phase F/H, `docs/categorization-engine.md` |
| Review queue ("Needs attention"): `/transactions/review`, `ReviewQueue*` | Phase G |
| Manual transactions, **splits** (`transaction_splits`), transfer detection | Phase E |
| Reporting: `report_preferences`, `report_runs`, `report_deliveries`, `report_artifacts`, cron scheduler, `report-math/delivery/pdf`, AI commentary | Phase J/K, `docs/reporting-engine.md` |
| Non-custodial boundary | ADR 0001 |

### What Spaces adds (the gap this program closes)

1. `workspaces.kind = 'household'` + household creation, onboarding, copy.
2. **`financial_sources`** — a person-owned source concept distinct from
   `accounts`, with a `visibility_mode`.
3. **`source_space_links`** — allocation of one source to one-or-more
   Spaces, with per-link visibility and a routing hint.
4. **`can_view_source_in_space()`** primitive + an RLS refactor so a
   Household member sees a co-member's source only through an explicit
   allocation — reverting Phase C's "membership ⇒ full ledger" for
   `household` workspaces only.
5. **`raw_financial_events`** upstream of `transactions` — normalise →
   validate → dedupe → canonical → allocate.
6. Transaction **attribution** (`performed_by_user_id`, `attribution_type`,
   `attributed_user_id`) distinct from source ownership; per-transaction
   **Space reassignment**.
7. **Statement (CSV/PDF) reconciliation** against the canonical ledger
   (SMS reconciliation already exists — Phase O).
8. **Household dashboard**, **space-aware AI scope boundary**,
   **per-member notification prefs**, **activity feed**, upgraded
   **Space switcher** + optional `/spaces/{id}/…` routes.

Nothing already listed as "reused as-is" changes shape.

---

## 2. Terminology

- **Space** = user-facing name for a `workspaces` row of any `kind`.
  Users see natural names ("Personal", "Niyoyo Household"), never
  "Household Workspace".
- Schema keeps `workspace` everywhere (`workspace_id`,
  `workspace_memberships`, `is_workspace_member`). No `spaces` /
  `space_memberships` tables — see ADR 0005 §1.
- Backend may say *canonical transaction*, *raw event*, *allocation*,
  *provenance*; **UI never does**. UI says "Transaction added to Niyoyo
  Household", "Shared", "Paid by Alice", "Only you can see this account".

---

## 3. Principles (from the master prompt, made concrete here)

- **Identity is independent of a Space.** Each collaborator signs in with
  their own OneLedger account. No shared logins, no impersonation, no
  copied tokens. (Already true — Phase B.)
- **Personal stays first-class.** Every user keeps exactly one
  auto-provisioned Personal Space that behaves exactly as today unless
  they deliberately switch. Existing users recreate nothing.
- **Collaboration lives in a Space**, and shared data is reachable only
  through explicit allocation + permission.
- **Source ownership ≠ Space membership.** A source belongs to one
  person; a Space may be permitted to *see* some of its activity.
- **OneLedger holds no funds.** "Available across shared accounts" is
  computed from provider balances of `share_account` sources only, never
  presented as a OneLedger balance (ADR 0001).
- **Deterministic, explained categorization and attribution.** No
  nondeterministic ordering; no guessed attributed member.

---

## 4. Data model

All additions are **additive and nullable-first**, following the Phase B /
Phase C split: an additive migration ships and bakes, a later
backfill-and-constrain migration tightens. No existing row is rewritten by
the additive step.

### 4.1 `workspaces.kind` extension

```
alter table public.workspaces drop constraint workspaces_kind_check;
alter table public.workspaces add constraint workspaces_kind_check
  check (kind in ('personal','organization','household'));
```

`create_household_workspace(p_name text) returns uuid` — SECURITY DEFINER,
mirrors `create_organization_workspace`; caller becomes sole `owner`.
Household defaults: `default_currency` / `timezone` inherited from the
creator's `profiles` row. No change to `handle_new_user()`.

Household role→capability defaults (RBAC layer, §5):

| | Owner | Admin | Member | Viewer |
|---|---|---|---|---|
| Space settings, delete, ownership transfer | ✓ | — | — | — |
| Invite / remove members, roles | ✓ | ✓ (not final owner, not → owner) | — | — |
| Budgets / goals / rules / report config | ✓ | ✓ | view; propose | view |
| Create transactions, upload receipts, categorize | ✓ | ✓ | ✓ | — |
| Connect **own** source, set its visibility | ✓ | ✓ | ✓ | — |
| See another member's source | only via allocation + `visibility_mode` | same | same | same |

There is always ≥1 owner (existing guard). Budget editing by Member is a
**permission grant**, not an approval workflow — no approval engine is
built (master prompt §7).

### 4.2 `financial_sources`

```
id                uuid pk
owner_user_id     uuid not null references auth.users(id)      -- always a person
provider          text not null   -- 'mtn_momo'|'airtel_money'|'bank'|'card'|'cash'|'statement'|'other'
source_type       text not null   -- 'mobile_money'|'bank_account'|'card'|'cash'|'import'
display_name      text not null
currency          char(3) not null default 'RWF'
masked_identifier text            -- '•••• 482', never a full number
visibility_mode   text not null default 'personal_only'
                    check (visibility_mode in ('personal_only','share_transactions','share_account'))
status            text not null default 'active' check (status in ('active','paused','archived'))
created_at / updated_at
```

`accounts` and `ingestion_connections` gain a nullable
`financial_source_id`. A backfill migration creates one `financial_sources`
row per existing `accounts` row, owned by that workspace's owner,
`visibility_mode = 'personal_only'`, and links them. `accounts` remains the
per-Space representation (balance, primary flag); `financial_sources` is
the cross-Space identity.

RLS: owner full; a non-owner sees a row only when
`can_view_source_in_space(id, <a workspace they're an active member of>)`
is true for some allocation.

### 4.3 `source_space_links`

```
id                uuid pk
financial_source_id uuid not null references financial_sources(id)
workspace_id      uuid not null references workspaces(id) on delete cascade
visibility_mode   text not null   -- per-link; may be <= the source's own mode, never >
is_default_target boolean not null default false   -- routing hint for new events from this source
effective_from    timestamptz not null default now()   -- no event before this date is allocable to this Space
created_by        uuid references auth.users(id)
created_at
unique (financial_source_id, workspace_id)
partial unique (financial_source_id) where is_default_target   -- at most one default per source
```

Every source has an implicit Personal link (the owner's Personal Space);
`source_space_links` holds the *additional* Space allocations. Creating a
link is owner-only. Deleting/pausing a link stops future allocation and
hides Space-allocated history from non-owners immediately (owner keeps it
in Personal).

### 4.4 `can_view_source_in_space(p_source_id uuid, p_workspace_id uuid) returns boolean`

SECURITY DEFINER, STABLE, `search_path = public`. True iff:

- caller is the source `owner_user_id` **and** is an active member of the
  Space, **or**
- caller is an active member of the Space **and** a `source_space_links`
  row exists for (source, Space) whose `visibility_mode` is
  `share_transactions` or `share_account`.

`grant execute … to authenticated, service_role`. Every transaction-,
balance-, and source-scoped RLS policy for `household` workspaces is
`is_workspace_member(workspace_id) AND can_view_source_in_space(source_id, workspace_id)`.
For `personal` / `organization` workspaces the policies are unchanged
(organization ledgers stay fully shared — ADR 0005 §2).

### 4.5 `raw_financial_events`

```
id                 uuid pk
financial_source_id uuid references financial_sources(id)
ingestion_connection_id uuid references ingestion_connections(id)
channel            text not null   -- 'sms'|'bank_api'|'email'|'statement'|'receipt'|'manual'
device_id          uuid references ...            -- origin device where applicable
received_at        timestamptz not null
payload_hash       text not null unique           -- dedupe of the *evidence*, not the transaction
raw_payload        jsonb not null                 -- exactly what we received; never discarded
parse_status       text not null default 'pending'
                     check (parse_status in ('pending','normalized','rejected','superseded'))
canonical_transaction_id uuid references transactions(id)   -- set once normalized
created_at
```

`ingest-momo` and the SMS-reconciliation path are refactored to **write a
`raw_financial_events` row first**, then normalize → validate → dedupe →
upsert the canonical `transactions` row → allocate to a Space. Existing
`momo_messages` becomes one producer of raw events (kept; not replaced in
Phase Q). Original evidence is retained on merge (master prompt §16).

### 4.6 `transactions` — provenance & attribution columns

Nullable additions (constrained later):

```
financial_source_id     uuid references financial_sources(id)
performed_by_user_id     uuid references auth.users(id)   -- who did the spend
created_by_user_id        uuid references auth.users(id)   -- who created the OL record (manual entry)
attribution_type          text check (attribution_type in ('shared','member','split','unassigned'))
attributed_user_id        uuid references auth.users(id)   -- required iff attribution_type='member'
allocation_status         text default 'allocated' check (allocation_status in ('allocated','needs_space','needs_attribution'))
```

- `workspace_id` is still set at ingest (default = the source's
  `is_default_target` link, else the owner's Personal Space). A
  **reassignment RPC** `reallocate_transaction(p_txn uuid, p_workspace uuid)`
  — member+ in both source-visible Spaces, audited — is the only way it
  changes. Budget/report/goal aggregates recompute on reassignment,
  recategorization, and attribution change (existing recompute hooks
  extended, not rewritten).
- `split` reuses `transaction_splits` (Phase E) with per-member rows;
  a `CHECK`/trigger enforces split rows sum to the transaction amount.
- `unassigned` / `needs_*` → surfaced in the Phase G review queue with
  resolve actions. The system never auto-picks an attributed member.

### 4.7 `space_activity` (human-readable feed) and audit

- **Activity feed**: `space_activity(id, workspace_id, actor_user_id,
  kind, summary text, ref_type, ref_id, created_at)` — append-only,
  member-readable, RLS `is_workspace_member(workspace_id)`. Rendered
  strings: "Alice joined Niyoyo Household", "Dolton changed Groceries
  budget", "Statement imported", "A duplicate was merged".
- **Audit log**: reuse the established pattern (`payment_audit_events`,
  `service_directory_audit_events`) — a `space_audit_events` table with
  `actor_user_id, workspace_id, event_type, resource_type, resource_id,
  old_value, new_value, ip, device, metadata`, no `authenticated` write
  grant, SELECT gated to owner/admin, written by SECURITY DEFINER RPCs
  only. Audited events: master prompt §61 list (space create, invite,
  accept, role change, removal, departure, ownership transfer, source
  sharing change, source connect/remove, budget/goal/rule change, txn
  reassignment, attribution change, duplicate merge, report-config
  change, archive/delete, security setting change).

### 4.8 `space_member_notification_prefs`

`(workspace_id, user_id, event_key, channel, enabled)` — each member
controls their own. Event keys per master prompt §37. Security-notable
events (§38: ownership transfer, new admin, sharing change, new trusted
device, permission change, integration change) are delivered regardless
of preference (row may exist but is ignored for `enabled=false`).
Channels: `in_app`, `email` (Resend, already wired) only — push/SMS
deferred. Dedup via a `notification_dispatch` state row keyed by
`(event_key, resource_id, user_id, threshold_bucket)`.

### 4.9 Categories scope

Categories are currently free-text on `transactions` + `merchant_rules` +
`budget_category_mappings`. Spaces adds a `category_scope` concept
(`platform` | `workspace`) via a light `workspace_categories` table
(workspace_id, key, label, parent_key). Platform categories remain the
shared default; a Household renaming/adding one does not touch any
member's Personal categories (master prompt §27). Rules
(`merchant_rules` / categorization policies) already carry `workspace_id`;
Phase R adds explicit `scope_type` + deterministic precedence
(manual override → source-specific → user personal → space → platform)
and rule-match explainability metadata on
`transaction_category_history` (already partly there).

---

## 5. Authorization model

Two orthogonal questions, both answered server-side:

1. **Can this role do this action?** — `workspace_memberships.role` vs a
   capability table (§4.1). Encoded in RLS `min_role` and in RPC guards.
2. **May this person see this resource?** —
   `can_view_source_in_space()` for sources/transactions/balances;
   `is_workspace_member()` for Space-level resources (budgets, goals,
   activity). Composed with `AND`.

RLS refactor (Phase Q, `household` only):

- `transactions_select_member` for `household` workspaces →
  `is_workspace_member(workspace_id) AND can_view_source_in_space(financial_source_id, workspace_id)`.
- New `financial_sources`, `source_space_links`, `raw_financial_events`,
  `space_activity`, `space_audit_events`,
  `space_member_notification_prefs`, `workspace_categories` policies.
- Service-role paths (`ingest-momo`, cron report generator, reconciler)
  re-assert authorization in code before returning financial data —
  never "came from our backend ⇒ authorized" (master prompt §59). The
  report generator must exclude former members and revoked-access users
  from delivery.
- AI (`web/lib/ai/facts.ts`): every fact query takes an explicit,
  validated `workspace_id` and filters to source-visible transactions
  only; it must never fall back to "all of this user's data" when the
  active context is a Household (master prompt §42).

Migration-test privilege counters (`authenticated` table-grant +
function-EXECUTE counts) move up by a known delta, with the reasoning
block extended Phase M/N/O/P-style — the review checkpoint for privilege
expansion.

---

## 6. Ingestion pipeline (refactor)

```
SMS / bank API / email / statement / receipt / manual
        │
        ▼  raw_financial_events   (evidence, payload_hash-deduped, never discarded)
        │
   normalize → validate → deduplicate (§7)
        │
        ▼  transactions            (canonical; upsert, counted once)
        │
   allocate → workspace_id         (source default-target link, else owner Personal)
        │
   categorize / rules / budget impact / attribution
```

- `ingestion_connections` still resolves `workspace_id` + `account_id` at
  connection-creation time from the credential hash — unchanged. Phase Q
  adds: resolve `financial_source_id` too, and route new canonical
  transactions via the source's `is_default_target` link.
- **Existing devices default to Personal.** No historical ingestion is
  ever moved into a Household without an explicit owner action
  (ADR 0005 §2, master prompt §63).
- `ingest-momo` change is additive: write the raw event, keep the current
  transaction upsert, add source + allocation resolution. Backward
  compatible on day one.

---

## 7. Deduplication & statement reconciliation

- **Dedupe signals**: provider reference / `external_transaction_id`,
  source, masked identifier, amount, currency, direction, timestamp
  (± window), counterparty, merchant, metadata fingerprint. Confidence
  states `unique | possible_duplicate | confirmed_duplicate | merged`.
  High-confidence auto-merge (evidence retained, audit entry, canonical
  counted once); medium-confidence → review queue "Possible duplicate"
  card with Keep both / Merge.
- **Statement import** (`docs` to add a runbook): upload → identify
  `financial_source` → extract rows → normalize → compare to canonical
  ledger → match known → create only missing → surface uncertain. Summary
  UI: "68 found · 51 matched · 15 new · 2 to review". Never blind-append.
  Reuses Phase O reconciliation primitives where possible.

---

## 8. Household dashboard, reports, AI

- **Dashboard** (`/` when active Space is a Household): available across
  `share_account` sources (only), income, expenses, net; household budget
  health with pace/projection (existing `budget-math.ts`); "N things need
  attention" (review queue); spending attribution Shared / per-member %;
  recent canonical transactions with paid-by + source; goal progress.
  Neutral framing — no "Alice spent 20% more than Dolton".
- **Reports**: `report_preferences` / `report_runs` gain `workspace_id`
  scope (nullable → backfill to personal). Household report ≠ personal
  report; a Household member never receives another member's personal
  report. Scheduler filters recipients to current active members with
  access; former members excluded. Timezone handling (Space vs member)
  already in `report-period.ts`.
- **AI**: §5 — validated `workspace_id`, source-visible transactions
  only, no private-balance / other-member leakage. Insight examples per
  master prompt §43 (category trend, projected overspend, recurring
  obligations, month-over-month variance) — evidence-based only.

---

## 9. Space switcher, routing, navigation, FAB

- **Switcher**: upgrade the current `<select>` (`WorkspaceSwitcher`) to a
  labelled menu with per-Space icon + name and "+ Create Space"; keep it
  hidden for single-Space users. Switching updates the **whole** app
  context (every route reads `getActiveWorkspaceId()` already).
- **Routing**: keep the cookie as the source of truth; optionally add
  `/spaces/{workspaceId}/…` canonical routes in Phase S for deep links /
  notifications, with every loader still calling the server-side
  membership + visibility check (never trust the URL segment).
  `active_workspace_id` fallback-to-personal on revoked access already
  exists.
- **Navigation**: no new top-level items. Household-only controls
  (Members, Financial Sources, Activity) live under Settings; Personal
  Space hides them. FAB becomes Space-aware (Household: add household
  expense / income / pay / upload receipt / connect source / invite),
  kept concise.

---

## 10. Migration & backward compatibility

- Every Phase Q table is new; every Phase Q column is nullable. Additive
  migration bakes; a `…_spaces_backfill_and_constraints.sql` migration
  then: creates `financial_sources` for existing `accounts`, links them,
  backfills `transactions.financial_source_id` +
  `report_*.workspace_id`, and tightens NOT NULLs. Idempotent /
  retryable; indexes created alongside (`financial_source_id`,
  `source_space_links(workspace_id)`, `raw_financial_events(payload_hash)`,
  attribution columns, activity/audit `workspace_id`).
- Existing users: unchanged experience. Personal stays default. No
  balance changes (unless fixing an identified bug). `ingest-momo`,
  scheduled reports, categorization, budgets, review queue all keep
  working through the additive step.
- Full backward-compat audit checklist = master prompt §64; each item is
  a test in the relevant phase.

---

## 11. Phase plan (mapped to the master prompt's 7 phases)

Continues this repo's letter convention. Each phase: design delta →
additive migration(s) → stacked PRs → migration-test block → e2e.

| Phase | Master prompt | Scope | User-visible? |
|---|---|---|---|
| **Q** — Foundation ✅ *migration written* | 1 | `kind='household'` + `create_household_workspace`; `financial_sources`, `source_space_links`, `raw_financial_events`, `can_view_source_in_space()` / `is_financial_source_visible()` / `owns_financial_source()`; nullable `transactions` provenance/attribution cols; `space_activity` / `space_audit_events` / `space_member_notification_prefs` / `workspace_categories` tables; **RLS refactor for `household`** (Phase C ledger loosening reverted for this kind via the source-visibility gate); backfill migration; indexes | No |
| **R** — Security & authz ✅ *migration written* | 2 | capability layer (`space_role_has_capability` matrix + `space_member_capability_grants` + `has_space_capability()` primitive + `grant`/`revoke_space_capability` RPCs); audit-write primitives (`record_space_activity` / `record_space_audit_event`); `workspace_invites.accepted_by`; `accept_workspace_invite` / `set_member_role` / `remove_member` / `create_household_workspace` re-issued to write audit + activity rows; **14-assertion security test block** (capability matrix, grant/revoke, audit visibility, invite re-use/revoke rejection, post-removal access revocation, last-owner guard, internal-helper lockdown, service-role bypass) | No |
| **S** — Shared ledger | 3 | **PR1 ✅:** `transaction_member_attributions` + `set_source_visibility` / `allocate_source_to_space` / `set_source_space_link_status` / `set_transaction_attribution` / `reallocate_transaction` RPCs. **PR2a ✅:** household creation (`/settings/workspace`), the "Shared accounts" surface (`/settings/sources`) — per-source visibility + share/pause/resume/revoke into households. **PR2b (not started):** transaction provenance detail view + attribution UI on `/transactions/[id]`; review-queue `needs_space` / `needs_attribution` reasons; household dashboard; upgraded Space switcher; e2e; optional `/spaces/{id}/…` routes | Yes |
| **T** — Financial planning | 4 | Space-aware category scope; rule `scope_type` + deterministic precedence + explainability; shared budgets (space/category/member scopes) reusing `budget-math.ts`; threshold state-transition alerts (no per-txn spam); shared goals as first-class Space resources; per-member notification prefs | Yes |
| **U** — Ingestion & reconciliation | 5 | `raw_financial_events` cutover for `ingest-momo` + SMS path; source routing (`is_default_target`); dedupe confidence engine + auto-merge + review cards; **statement (CSV/PDF) reconciliation** vs ledger + import summary; device management UX (rename / pause / reconnect / remove, history preserved) | Yes |
| **V** — Reporting & intelligence | 6 | `workspace_id` scope on `report_*`; Household report template + attribution summaries; scheduler recipient filtering (exclude former members); AI Space-scope boundary + Household insights; dashboard projections | Yes |
| **W** — UX hardening & production readiness | 7 | Responsive + a11y pass (no colour-only budget status); loading/empty/error/permission-denied/removed-member/expired-invite states; onboarding + help/tooltip/seeded-content updates; analytics events; monitoring (migration failures, RLS denials, reconciliation failures, dashboard latency); feature-flag rollout (internal → beta → GA); migration validation on realistic data; security + performance review | Yes |

Feature flag: reuse the existing flag mechanism (Phase P shipped feature
flags). Migration compatibility must hold even with the Household UI flag
off.

### Phase Q — as built (migrations `20260910000000` + `20260911000000`)

Two deviations from the plan above, both to stay non-breaking:

1. **`accounts.financial_source_id` / `transactions.financial_source_id`
   are left nullable.** The backfill populates both to completeness for
   every row that exists today, but the app's own account-creation and
   ingestion write paths do not set the column yet; a `NOT NULL` now
   would break them. Phase S (account creation through the source model)
   and Phase U (ingestion cutover) add the respective constraints once
   every writer populates the column. A NULL is harmless for
   personal/organization workspaces — `can_view_source_in_space()`
   collapses to `is_workspace_member()` there.
2. **`financial_sources_select_visible` leads with a bare
   `owner_user_id = auth.uid()` before the `is_financial_source_visible()`
   call.** `INSERT ... RETURNING` re-checks the SELECT policy against the
   just-inserted row, and a STABLE SECURITY DEFINER function cannot see
   that row mid-statement — the function-only form made every
   `insert ... returning id` by the owner fail RLS.

Migration-test coverage: `run_migration_tests.sh` gains an 11-assertion
"Phase Q" block (household creation, source-ownership isolation, the
"joining shares nothing" hard rule, explicit-allocation visibility, share
forging rejection, link-pause revocation, personal-workspace regression
guard, service_role bypass); privilege counters move to 67 tables / 114
`authenticated` table grants / 52 `authenticated` function grants.

### Phase R — as built (migration `20260912000000`)

Chose a **hardcoded `IMMUTABLE` matrix function** (`space_role_has_capability`)
over a seeded capability table — smaller, deterministic, matches
`is_workspace_member`'s style, and the master prompt explicitly defers
"complex custom roles". Per-member exceptions (e.g. "let this Member edit
budgets") are the one extension point: additive-only rows in
`space_member_capability_grants`, written exclusively through
`grant_space_capability` / `revoke_space_capability` (both `members.manage`-
gated). `has_space_capability(workspace, capability)` is the primitive
Phase S/T RPC guards will compose with; **it is not yet wired into any
budget/goal/rule flow — RLS stays the live control until Phase T.**

`record_space_activity` / `record_space_audit_event` are internal
(`revoke all from public`, no `authenticated` grant) — invoked only from
other `SECURITY DEFINER` RPCs, which run as the table owner and so bypass
the append-only tables' RLS. `accept_workspace_invite`, `set_member_role`,
`remove_member`, and `create_household_workspace` were re-issued
(`CREATE OR REPLACE`, signatures/grants unchanged) to call them.
`workspace_invites.accepted_by` records the bearer-token redeemer — the
audit compensation for the deliberately email-agnostic acceptance model.
`remove_member` also deletes the departing member's capability grants.

Migration-test coverage: 14-assertion "Phase R" block — capability matrix,
grant/revoke + audit, `space_audit_events` owner/admin-only visibility,
`space_activity` member visibility, internal-helper lockdown,
`accepted_by` + join audit, re-used / revoked token rejection,
post-removal access revocation + `member.removed` audit, last-owner guard
survival, `member.role_changed` audit, service-role bypass. Privilege
counters move to 68 tables / 115 `authenticated` table grants / 55
`authenticated` function grants.

### Phase S PR1 — as built (migration `20260913000000`)

Backend only — the web UI is PR2. Every RPC is `SECURITY DEFINER` and
**refuses a non-household target** (personal/organization ledgers keep
their existing model).

- **`transaction_member_attributions`** — per-member basis-point "who
  spent this" split for `attribution_type='split'`. Parallel to Phase E's
  `transaction_splits` (a different axis: budget buckets, not people).
  Deferrable constraint trigger enforces the set totals exactly 10000 bps
  when non-empty; a zero total (all rows deleted) is the valid "not
  split" state. `SELECT`-gated by `can_view_source_in_space`; written only
  by `set_transaction_attribution`.
- **`set_source_visibility(source, mode)`** — owner sets the ceiling.
  Narrowing cascades: `→ personal_only` revokes every active share link
  (one audit + activity row per affected Space); `→ share_transactions`
  downgrades any `share_account` link.
- **`allocate_source_to_space(source, workspace, mode, is_default,
  effective_from)`** — the "How should this account be used?" action.
  Owner-only, household-only, member-of-target. Upserts the
  `source_space_links` row and raises the source's own ceiling to at
  least `mode` so one call is all the UI needs.
- **`set_source_space_link_status(source, workspace, status)`** — owner
  pauses / resumes / revokes one link (Phase Q RLS already keys off
  `status='active'`, so pause cuts co-member access immediately).
- **`set_transaction_attribution(txn, type, attributed_user, splits)`** —
  household-only; needs `transaction.categorize` + source visibility;
  validates the member / every split participant is an active member;
  never guesses.
- **`reallocate_transaction(txn, target_workspace)`** — moves a
  transaction between Spaces its source is visible in. v1 **refuses** a
  transaction carrying Space-scoped derived data (budget split, transfer
  link, goal contribution, payment match — "resolve those first"), and
  enforces the no-retroactive-exposure boundary (`effective_from`) when
  moving into a household. Clears attribution and sets
  `allocation_status='needs_attribution'` on landing in a household.

Migration-test coverage: 15-assertion "Phase S" block. Privilege counters
move to 69 tables / 116 `authenticated` table grants / 60 `authenticated`
function grants.

### Phase S PR2a — as built (web)

First user-visible Spaces UI. Two surfaces, both under Settings — no new
top-level nav (master prompt §48):

- **`/settings/workspace`** — the personal-workspace view now leads with
  "Start a household" (`create_household_workspace`); organization
  creation stays as the secondary option. A household's member/invite
  view reuses the existing kind-agnostic components and points members at
  Shared accounts for per-source sharing. `WorkspaceSummary.kind` gains
  `"household"`.
- **`/settings/sources`** ("Shared accounts") — lists the sources the
  caller *owns* (`getMyFinancialSources`, filtered to `owner_user_id`),
  each showing its visibility ceiling and its active/paused share links.
  Per source: **Share with a household** (pick household + "Transactions
  only" / "Balance & transactions" + optional default-target) →
  `allocate_source_to_space`; **Pause / Resume / Stop sharing** per link →
  `set_source_space_link_status`; **Make private** (confirm) →
  `set_source_visibility('personal_only')`. Every mutation is a
  `"use server"` action that only calls the RPC — ownership and household
  checks live in the RPC, never the client. Plain-language copy
  throughout ("Nothing is shared until you say so").

Members-management for a household is still owner-only (the Phase C
`workspace_invites` / `set_member_role` / `remove_member` RLS is
`is_workspace_member(_, 'owner')`); wiring those to
`has_space_capability(_, 'members.manage')` so a household **admin** can
manage members is a small follow-up. No e2e added here — the RPC layer is
covered by the migration suite; a `/settings/sources` Playwright spec is a
PR2b item.

---

## 12. Testing strategy (per phase, aggregated here)

- **Unit**: role→capability, `can_view_source_in_space` truth table,
  attribution + split math, budget thresholds, dedupe fingerprinting,
  rule precedence, allocation routing, report scope, notification
  recipient selection.
- **Integration**: household create → invite → accept → remove; source
  share/unshare; transaction create/reallocate; statement import; dedupe
  merge; scheduled report scope; AI data scope.
- **Security** (gate before Phase S UI): cross-Household read, guessed
  Space IDs, forged `workspace_id` on write, private source via Household,
  access after removal, stale/forwarded/revoked invite, role escalation,
  private personal report access, AI scope leakage, direct
  Supabase-query bypass, service-role path re-auth.
- **Migration**: representative existing-user dataset — transaction /
  budget / source / report counts and balances identical before/after;
  ingestion + scheduled jobs still fire.
- **UI matrix**: master prompt §85 (new/existing/personal-only user;
  Owner/Admin/Member/Viewer; invited-not-accepted; removed; 1-member vs
  many; 0/1/many sources; transactions-only vs fully-shared source;
  no/exceeded budget; 0/many goals; pending duplicate; archived Space).

---

## 13. Deferred (architected-for, not built — master prompt §75)

Splitwise-style settlement/debt tracking; real-time household messaging;
custom roles / per-field permissions; child-guardian controls; business
bookkeeping / double-entry overhaul; bank joint-account creation; payment
custody / pooled funds / inter-member transfers; accountant portals;
enterprise approval chains; cross-Space global search (may be added later;
must authorize every result).

---

## 14. Open questions / assumptions

1. **Household currency mixing** — assume a Household has one
   `default_currency`; sources in other currencies show native amount +
   converted estimate (no FX engine built). Confirm.
2. **Viewer role for a Household** — shipped in Phase S or deferred to
   post-GA? Assumed built (schema already supports it) but hidden behind
   the flag until there's a use case (accountant/adviser).
3. **`organization` vs `household`** — organizations keep the fully-shared
   ledger; only households get the per-source visibility model. Confirm no
   demand to retrofit visibility onto organizations now.
4. **Statement parsing** — which bank formats for the first
   reconciliation release (BK, Equity, …)? Drives Phase U scope.
5. **`effective_from` default** — link-creation time (assumed) vs
   start-of-current-period. Affects how much history appears when a
   source is first shared.
