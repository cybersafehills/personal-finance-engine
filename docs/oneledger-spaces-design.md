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
| **S** — Shared ledger | 3 | **PR1 ✅:** `transaction_member_attributions` + the five sharing/attribution/reallocation RPCs. **PR2a ✅:** household creation (`/settings/workspace`), "Shared accounts" (`/settings/sources`). **PR2b ✅:** `space_member_directory` fn; transaction detail gets a "Where this came from" provenance panel + a household "Whose spending" attribution panel (shared / member / split / unassigned) + a needs-attention banner; review queue gets a "Needs attribution" section. **PR2c ✅:** household dashboard block (name header + `HouseholdSpendingCard` — spending-this-month by member, neutral framing) on `/`; upgraded Space switcher (kind-labelled list + "Create a Space" in the account menu, current-Space chip in the header). **PR2d ✅:** household/organization **Admin** can now manage members — `workspace_invites` RLS + `set_member_role` / `remove_member` re-issued from Owner-only to `has_space_capability(_, 'members.manage')`, with anything touching an Owner staying Owner-only and the last-owner guard intact. **PR2e ✅:** `e2e/spaces-household.spec.ts` — single-user Playwright flow (create household → share a source via `/settings/sources` → dashboard household block → resolve an unattributed transaction on `/transactions/[id]`) + a `/settings/sources` a11y check. **Phase S essentially complete.** Deferred to a later refinement: "available across shared accounts" balance semantics; optional `/spaces/{id}/…` routes; a two-user attribution e2e (the suite currently shares one identity) | Yes |
| **T** — Financial planning | 4 | **PR1 ✅:** per-member notification prefs — `should_notify()` / `notification_event_catalog()` + `/settings/notifications`. **PR2 ✅:** budget threshold-crossing state — `budget_threshold_state` + `record_budget_threshold_crossing()` (one alert per upward crossing, not per transaction; service-role-only, Phase V consumes it). **PR3 ✅:** shared goals — `financial_goals` / `goal_contributions` writes moved to the capability model (Admin can manage goals; any member can contribute), `financial_goals.linked_account_id` / `.monthly_contribution_target_minor`, `goal_participants` table, `set_goal_participants()` + `goal_progress()` (the §26 computed metrics). **PR3b ✅:** goal detail page gets a `GoalProgressCard` (remaining / needed-per-month / observed rate / projected completion / on-track) + `GoalParticipants` (participant list; owner/admin edit via a member checklist → `set_goal_participants`). **PR4 ✅:** Space category vocabulary — `workspace_categories` writes routed through `upsert_workspace_category` / `set_workspace_category_archived` (`category.manage`-gated, audited; direct authenticated writes revoked); `/categories` gets a "This Space's categories" panel (owner/admin add/archive/restore) and the category-correction form offers the Space labels ∪ seen names as a `<datalist>`. **PR5 (not started):** rule `scope_type` + deterministic precedence + explainability (cross-cutting into the ingestion `policy-engine.ts` — deferred to Phase U's ingestion cutover) | Yes |
| **U** — Ingestion & reconciliation | 5 | **PR1 ✅:** ingestion primitives (migration only) — `compute_transaction_fingerprint()`, `resolve_ingestion_target(connection, at)` (default = the connection's workspace; an opened `is_default_target` source link overrides), `transaction_duplicate_candidates()`, `merge_duplicate_transaction()` (row kept, audited); `transactions.dedupe_fingerprint` / `.dedupe_state` / `.merged_into_transaction_id`. **PR2+ (not started):** `ingest-momo` + SMS-path Deno cutover to `raw_financial_events` + these primitives; dedup review cards + aggregation excludes merged; statement (CSV/PDF) reconciliation + import summary; device management UX; rule `scope`/precedence/explainability (deferred here from Phase T) | Yes |
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

### Phase S PR1 — as built (migration `20260914000000`)

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
PR2c item.

### Phase S PR2b — as built (migration `20260915000000` + web)

- **`space_member_directory(workspace_id)`** — `SECURITY DEFINER` /
  `STABLE`, returns `(user_id, display_name, role)` for active members,
  gated so only an active member of that Space gets rows (bounded
  disclosure past `profiles_select_own`). The one place a co-member's
  display name is exposed; the attribution UI needs it. `authenticated`
  function-EXECUTE count → 61. One migration-test assertion.
- **`/transactions/[id]`** gains, for any transaction that resolves a
  Space context: a **"Where this came from"** panel (Space · From
  \<source + provider + masked id, "· X's account" when the source owner
  isn't you\> · Paid by · Added by · Imported via) and, when the Space is
  a household, a **needs-attention banner** (`allocation_status !==
  'allocated'`) and a **"Whose spending"** attribution panel —
  `TransactionAttributionPanel` (shared / one member / basis-point split /
  unassigned), driven by `set_transaction_attribution`. Split editor is
  in whole percents, converted to bps, submit gated on a 100 % total.
- **Queries:** `getTransactionSpaceContext`, `getSpaceMemberDirectory`,
  `getNeedsAttributionTransactions`, `getAuthUserId` in `lib/queries.ts`.
  `TransactionRow` / `TRANSACTION_COLUMNS` deliberately left untouched —
  the Space fields are read through the dedicated context query.
- **`/transactions/review`** gains a **"Needs attribution (N)"** section
  above the category-review list — plain links into
  `/transactions/[id]`, where the attribution panel resolves them. The
  existing category-review machinery is untouched (its confirm/dismiss/
  bulk flow does not apply to attribution).

`next build` ✓ compiled, `eslint` 0 errors. Full migration suite: 192
passed / 0 failed.

### Phase S PR2c — as built (web only)

- **Household dashboard block** on `/` — when the active Space is a
  household: a name header + `HouseholdSpendingCard`. New query
  `getHouseholdSpendingBreakdown()` sums settled outgoing spend for the
  current Kigali month and buckets it by attribution — `Shared`, each
  member (from `attributed_user_id`, and basis-point-weighted from
  `transaction_member_attributions` for splits), and `Unassigned`. Bars
  **plus** an explicit `amount · N%` label (not colour-only, §56); no
  "who spent more" comparison framing (§22). Returns `null` for
  personal/organization Spaces, so the dashboard is unchanged there.
- **Space switcher** — the bare `<select>` in the account menu becomes a
  kind-labelled option list (`Personal` / `Household` / `Organization`)
  with the active Space highlighted and a "Create a Space" link;
  `ProfileMenu` also shows the current Space name as a chip in the header
  (≥ sm). Switching still just sets the `active_workspace_id` cookie and
  refreshes.

No migration, no schema change. `next build` ✓ compiled, `eslint` 0
errors.

### Phase S PR2d — as built (migration `20260916000000` + web)

Closes the gap where the Phase R capability matrix granted an **Admin**
`members.manage` but the actual mutation surface was still Owner-only from
Phase C:

- `workspace_invites` `select` / `insert` / `update` policies re-issued
  from `is_workspace_member(_, 'owner')` to
  `has_space_capability(_, 'members.manage')` (the invite `role` CHECK
  still forbids issuing an Owner invite, so an Admin can invite at most
  another Admin).
- `set_member_role` / `remove_member` (`CREATE OR REPLACE`, grants and
  audit calls unchanged): `members.manage` to act at all; **Owner-only**
  to promote to / demote / remove an Owner; the last-owner guard is
  unchanged.
- `/settings/workspace` — `canManage` now includes `role === 'admin'`,
  so an Admin sees the invite form and member controls. Owner-only
  operations still fail server-side with the RPC's message.

No privilege-counter change (re-issues only). Migration-test coverage:
7-assertion "Phase S PR2d" block (Admin invites; Admin changes a
non-Owner role + audit; Admin cannot promote to Owner; Admin cannot
remove an Owner; Admin removes a plain member; a plain member still
cannot; last-owner guard survives). Full suite: 199 passed / 0 failed.

### Phase S PR2e — as built (e2e)

`web/e2e/spaces-household.spec.ts` (runs in the CI `chromium-desktop`
project against a disposable local Supabase stack, same as every other
spec). One flow test — the seeded e2e user creates a household, shares a
seeded `financial_sources` row into it via `/settings/sources`
("Transactions only"), sees the household dashboard block with an
`Unassigned` bucket, finds the transaction in the review queue's "Needs
attribution" section, and resolves it to `Shared` on
`/transactions/[id]` — plus a `/settings/sources` axe check. Everything
it creates (source, household, account, transaction) is deleted in
`afterEach` so the shared DB is left empty for `visual.spec.ts`.

Single-user by necessity (the suite shares one identity), so it covers
the owner's side of `create_household_workspace` /
`allocate_source_to_space` / `set_transaction_attribution`. A two-user
test (co-member visibility, `member` / `split` attribution through the
UI) needs a second seeded identity and is deferred.

With this, **Phase S is functionally complete** across schema (PR1),
the settings surfaces (PR2a), transaction provenance/attribution (PR2b),
the household dashboard + Space switcher (PR2c), Admin member-management
(PR2d), and e2e (PR2e).

---

## 11a. Phase T PR1 — as built (migration `20260917000000` + web)

Per-member notification preferences. `space_member_notification_prefs`
(Phase Q) already stores the overrides with full authenticated CRUD; this
PR adds the read side and the settings UI.

- **`should_notify(workspace, user, event_key, channel) → boolean`** —
  `SECURITY DEFINER` / `STABLE`, the primitive Phase V's report /
  notification jobs compose with. `false` for a non-member or former
  member (§41); `true` unconditionally for a **security-notable** event
  (§38: member add/remove, ownership transfer, sharing change,
  permission/integration change, trusted-device connect) on either
  channel; otherwise the member's stored `enabled`, or the event/channel
  default.
- **`notification_default_enabled` / `notification_event_is_security_notable`**
  — pure `IMMUTABLE` helpers, `revoke all from public`, called only from
  `should_notify`.
- **`notification_event_catalog()`** — the 12-event toggle list the
  settings UI renders from (defaults + which are security-notable),
  inlined as a `values` list so it needs no nested EXECUTE grants.
- **`/settings/notifications`** — per-event in-app / email checkboxes for
  the active Space; security-notable rows show "Always on" and are
  disabled. Toggling `upsert`s / deletes a `space_member_notification_prefs`
  row through the caller's own RLS. Hidden for a Personal Space.

`authenticated` function-EXECUTE count → 63 (`should_notify` +
`notification_event_catalog`). 4-assertion "Phase T PR1" migration-test
block (non-member → false; default follow-through; stored override;
security-notable can't be suppressed; catalog populated). Full suite:
203 passed / 0 failed. `next build` ✓, `eslint` 0 errors.

No delivery path is wired yet — `should_notify` has no caller until
Phase V. Nothing about notifications changes for existing users.

## 11b. Phase T PR2 — as built (migration `20260918000000`)

`web/lib/budget-math.ts` computes budget alerts fresh on every read and
does not persist them — "since that's real notification infrastructure
this project doesn't have yet" (its own comment). This PR is that
infrastructure.

- **`budget_threshold_state`** — one row per `(budget_id, scope)` (`scope`
  = a `budget_allocations.allocation_type` or `'__total__'`) holding the
  last bucket a periodic job observed. RLS on, **service-role-only**, no
  authenticated policy (like `raw_financial_events`).
- **`budget_bucket_for_percent(percent)`** — pure `IMMUTABLE`:
  `ok` < 75 ≤ `watch` < 90 ≤ `at_risk` < 100 ≤ `exceeded` < 110 ≤ `over`
  (§25's 75 / 90 / 100 / 110 thresholds).
- **`record_budget_threshold_crossing(budget_id, scope, percent)`** —
  `SECURITY DEFINER`, service-role-only. Upserts the tracked bucket and
  returns the new bucket name **only on a strictly upward crossing** —
  one alert per crossing, not one per transaction (§25). A same-or-lower
  bucket updates state silently and returns `NULL`, so spending that
  drops back and later climbs again produces a fresh alert.

No authenticated privilege change; table count → 70 (69 with RLS).
2-assertion "Phase T PR2" block (the full crossing sequence
50→80→82→95→60→92 → `NULL,watch,NULL,at_risk,NULL,at_risk`; not
authenticated-callable). Full suite: 205 passed / 0 failed. Migration
only — no web, no behaviour change until Phase V's periodic job calls it.

## 11c. Phase T PR3 — as built (migration `20260919000000`)

Shared goals as first-class Space resources (§26). Migration only.

- **Write policies to the capability model:** `financial_goals`
  insert/update → `has_space_capability(_, 'goal.manage')` (Owner+Admin);
  `goal_contributions` insert → `is_workspace_member(_, 'member')` (§7:
  "participate in goals"); delete → `goal.manage` **or** the row's
  `created_by`. Unchanged for personal workspaces. `refresh_goal_current_
  amount` (Phase D) re-issued `SECURITY DEFINER` so the authoritative sum
  is still maintained when a non-manager member contributes (the
  re-issued `financial_goals` update policy would otherwise filter the
  trigger's recompute to zero rows).
- **`financial_goals.linked_account_id`** / **`.monthly_contribution_target_minor`**
  — nullable, additive.
- **`goal_participants`** — which active members are in on a goal
  (advisory: a non-participant can still contribute; drives notification
  targeting and report framing). RLS member-read, `SELECT`-only for
  `authenticated`, written only by `set_goal_participants()`.
- **`set_goal_participants(goal_id, user_ids[])`** — `goal.manage`-gated,
  validates every id is an active member, replaces the set, audits
  `goal.participants_changed`.
- **`goal_progress(goal_id)`** — `SECURITY DEFINER` / `STABLE`,
  member-readable: target / current / `pct_complete` (capped 100) /
  `months_to_target` / `required_monthly_minor` (to hit `target_date`) /
  `recent_monthly_rate_minor` (observed 90-day rate) /
  `projected_completion_date`.

Table count → 71 (70 with RLS); `authenticated` table grants → 117
(`goal_participants` select); `authenticated` function count → 65
(`set_goal_participants` + `goal_progress`). 7-assertion "Phase T PR3"
block. Full suite: 212 passed / 0 failed. Web (goal-progress display +
participant picker) is PR3b.

## 11d. Phase T PR3b — as built (web)

`/budgets/goals/[id]` gains two cards below the progress bar:

- **`GoalProgressCard`** (server) — from `goal_progress()`: remaining,
  time to target date, needed-per-month to hit it, the observed 90-day
  contribution rate, the projected completion date, and an on-track /
  behind-pace line. Shown for **every** goal, personal or shared.
- **`GoalParticipants`** (client) — from `getGoalCollaboration()` (which
  returns `null` for a personal Space, so this only appears for
  household/organization goals): the participant names, plus — for an
  Owner/Admin — an inline member checklist that calls
  `set_goal_participants`. Copy makes clear a non-participant member can
  still contribute.

New queries: `getGoalProgress`, `getGoalCollaboration` in
`lib/queries.ts`; `setGoalParticipants` action. No migration, no schema
change. `next build` ✓ compiled, `eslint` 0 errors.

## 11e. Phase T PR4 — as built (migration `20260920000000` + web)

`workspace_categories` (Phase Q) had a table but no write RPCs and no
consumer. This makes it a real per-Space *vocabulary* — add / relabel /
archive preferred names, offered as suggestions. Categories on
transactions stay free-text (§27).

- **Writes routed through RPCs** (matching the `space_activity` /
  `goal_participants` pattern): `workspace_categories_insert_admin` /
  `_update_admin` dropped, `authenticated`'s `insert`/`update` grants
  revoked (SELECT stays). `upsert_workspace_category(workspace, key,
  label, parent_key)` and `set_workspace_category_archived(workspace,
  key, archived)` — both `category.manage`-gated, audited
  (`category.upserted` / `.archived` / `.restored`); re-adding an
  archived key un-archives it; key validated `^[a-z0-9][a-z0-9_-]{0,48}$`.
- **`/categories`** gains a "This Space's categories" panel (shown for
  household / organization Spaces): the list, plus an add field and
  archive/restore for an Owner/Admin. `getSpaceCategoryManagement()`.
- **Category-correction form** gets a `<datalist>` — the Space's
  non-archived labels first, then any category name already seen on a
  transaction (`getCategorySuggestions()`). Free typing still works.

`authenticated` table grants → 115 (−2, the revoked insert/update);
`authenticated` function count → 67 (+`upsert_workspace_category` +
`set_workspace_category_archived`); table count unchanged. 6-assertion
"Phase T PR4" block. Full suite: 218 passed / 0 failed. `next build` ✓,
`eslint` 0 errors.

## 11f. Phase U PR1 — as built (migration `20260921000000`)

The SQL foundation the `ingest-momo` cutover (PR2, a Deno change) will
call. Migration only — no behaviour change until PR2 wires ingestion.

- **`transactions.dedupe_fingerprint`** / **`.dedupe_state`**
  (`unique` | `possible_duplicate` | `confirmed_duplicate` | `merged`) /
  **`.merged_into_transaction_id`**, with a biconditional CHECK
  (`merged` ⟺ `merged_into_transaction_id is not null`). Partial index on
  the fingerprint.
- **`compute_transaction_fingerprint(source, masked_id, amount, currency,
  direction, counterparty, occurred_at)`** — pure `IMMUTABLE`;
  case/punctuation/whitespace-normalised, `occurred_at` rounded to the
  minute. Ingestion-only (`service_role`).
- **`resolve_ingestion_target(connection, occurred_at)` →
  `(workspace_id, financial_source_id)`** — `SECURITY DEFINER` / `STABLE`.
  Default = the connection's bound workspace; an active `is_default_target`
  source link whose window has opened (`effective_from <= occurred_at`)
  overrides it. Ingestion-only.
- **`transaction_duplicate_candidates(fingerprint, exclude_id)`** —
  same-fingerprint transactions the caller can see (all, for a
  service-role reconciler), excluding `merged` rows.
- **`merge_duplicate_transaction(duplicate_id, canonical_id)`** —
  `SECURITY DEFINER`; same-Space + `transaction.categorize` for an
  authenticated caller. Marks the duplicate `merged` + sets
  `merged_into_transaction_id` — **never deletes** it (evidence preserved,
  §16). Audited `transaction.duplicate_merged`.

`authenticated` function count → 69 (`transaction_duplicate_candidates` +
`merge_duplicate_transaction`; the two ingestion functions are
`service_role`-only). No table / table-grant change. 5-assertion "Phase U
PR1" block. Full suite: 223 passed / 0 failed.

---

## 11g. Phase U PR2 — as built (Deno: `ingest-momo`)

The `ingest-momo` cutover onto the PR1 primitives. **Deno only — no
migration, no new grant.** Routing and balance maths are untouched by
design (§ "no balance/routing changes unless fixing a bug"): the canonical
transaction still lands in the connection's bound workspace/account. What
changed is that ingestion now (a) records evidence in
`raw_financial_events` and (b) stamps duplicate-detection state.

- **New `supabase/functions/ingest-momo/raw-event.ts`** — pure builders,
  unit-tested in isolation because `index.ts` has no harness:
  `buildRawFinancialEvent` (the `channel='sms'` evidence row),
  `fingerprintArgs` (RWF is zero-decimal, so `amount_rwf` is already the
  minor unit; source defaults to `mtn_momo`; threads the source's
  `masked_identifier` when the routed account has one),
  `deriveDedupeState` (`>0` visible same-fingerprint peers ⇒
  `possible_duplicate`; **anything else, including a failed lookup, stays
  `unique` — ingestion is never blocked by dedupe**).
- **`raw_financial_events` write** happens right after the `momo_messages`
  row, before parsing — deduped on the *same* normalised-message SHA-256
  `momo_messages` uses (`payload_hash` UNIQUE ⇒ reuse the existing row on
  `23505`). Best-effort: any failure logs and continues with a null id.
  `parse_status` then tracks the outcome — `rejected` (parser miss),
  `superseded` (MTN transaction-id duplicate, linked to the existing
  transaction), or `normalized` + `canonical_transaction_id` +
  `financial_source_id` on success. A routing/insert failure leaves it
  `pending` (retryable — the retry reuses it via the `23505` path).
- **`connection-resolver.ts`** now carries the routed account's
  `financial_source_id` + the source's `masked_identifier` through
  `ResolvedIngestionRoute` (via a PostgREST embed on the account lookup).
  Routing is unchanged — this is provenance, not a new decision.
- **Transaction insert** gains `financial_source_id` (the routed account's
  linked source, nullable — the seed account has none),
  `dedupe_fingerprint` (from `compute_transaction_fingerprint`), and
  `dedupe_state`. `possible_duplicate` rows are logged
  (`possible_duplicate_ingested`) and surfaced for review in a later PR —
  **never auto-merged here**. The existing MTN transaction-id check still
  runs first and still short-circuits exact redeliveries.

Tests: new `tests/raw_event_test.ts` (7 cases) + a `connection_resolver`
case for the source/masked-id passthrough. `deno fmt --check` / `deno
lint` / `deno check ingest-momo` / `deno test ingest-momo` (74) / `deno
test _shared` (71) all green.

Deferred to PR3+: `resolve_ingestion_target` space-override routing
(`is_default_target`); duplicate review cards + auto-merge; aggregation
(budgets/reports) excluding `merged`; statement (CSV/PDF) reconciliation;
device-management UX; rule `scope` / precedence / explainability.

---

## 11h. Phase U PR3 — as built (migration `20260922000000`, backend)

The read + dismiss half of duplicate resolution — the surface for the
`possible_duplicate` rows PR2 ingestion now produces in production (the
merge half, `merge_duplicate_transaction`, already shipped in PR1).
**Migration only — two functions, no table, no column.**

- **`space_duplicate_review(p_workspace_id)`** — `SECURITY DEFINER` /
  `STABLE`, `authenticated` + `service_role`. Flat feed (one row per
  transaction) of every non-`merged` transaction that shares a
  `dedupe_fingerprint` with at least one `possible_duplicate` row in the
  Space **and** that the caller can see (`can_view_source_in_space`, which
  already folds in membership + per-source household visibility; the
  `auth.uid() is null` branch is the service-role reconciler path, same as
  `transaction_duplicate_candidates`). The caller groups by `fingerprint`
  to render one review card per cluster. A cluster stays in the feed in
  full — including rows already marked `unique` — until **no** member is
  `possible_duplicate` any more.
- **`dismiss_possible_duplicate(p_transaction_id)`** — `SECURITY DEFINER`,
  `authenticated` + `service_role`. `possible_duplicate` → `unique` only
  (raises on any other state; never touches `merged` / `confirmed`, never
  deletes). `transaction.categorize` in the row's Space for an
  authenticated caller. Audited `transaction.duplicate_dismissed`
  (old/new `dedupe_state` in the payload).

`authenticated` function count → 71. No table / table-grant change.
7-assertion "Phase U PR3" block (cluster shape, merged-exclusion,
non-member blindness, dismiss + audit + feed transition, wrong-state
refusal, capability refusal, cluster clears when fully resolved). Full
suite: **229 passed / 0 failed**.

Deferred to **PR3b (web)**: the `/transactions/review` "Possible
duplicates" card surface wired to `space_duplicate_review` +
`merge_duplicate_transaction` + `dismiss_possible_duplicate`, and the
budget/report/dashboard aggregation sweep to exclude `dedupe_state =
'merged'` (no live effect until a merge happens, which only this surface
enables — so the two ship together).

---

## 11i. Phase U PR3b — as built (web)

The consumer for PR3's RPCs, plus the aggregation correction that must
ride with the merge button. **Web only — no migration.**

- **`getSpaceDuplicateReview()`** (`web/lib/queries.ts`) calls
  `space_duplicate_review(active_workspace)` and groups the flat rows into
  one `DuplicateReviewCluster` per fingerprint.
- **`/transactions/review`** gets a "Possible duplicates (N)" section
  above the existing needs-attribution / category-review ones, rendered by
  the new client `DuplicateReviewList`. Per cluster: transactions listed
  oldest-first, a radio to pick the "original" (defaults to the earliest),
  and for every still-`possible_duplicate` sibling **Merge into original**
  (`merge_duplicate_transaction`) / **Not a duplicate**
  (`dismiss_possible_duplicate`). Resolved (`unique`) siblings stay shown,
  badged, no actions. `router.refresh()` after each action.
- **Aggregation sweep** — `.neq("dedupe_state", "merged")` added to every
  `web/lib/queries.ts` helper that sums or lists live transactions:
  `getCurrentBalance`, `getTodayTotals`, `getRecentTransactions`,
  `getTransactions`, `getCategoryTotals`, `getBudgetActuals` (both the
  out and in legs; `getDashboardBudgetSummary` inherits it),
  `getVariableIncomeMonths`, `getHouseholdSpendingBreakdown`. Review /
  needs-attribution / transfer / history / detail-by-id reads are left
  untouched (a merged row is rare there, and a direct link to one should
  still resolve). No shipped SQL RPC aggregates `transactions` spend
  (budget/goal SUMs are over `budget_allocations` / `goal_contributions`),
  so nothing on the DB side needed the same change.
- The merge action also revalidates `/` and `/budgets` (a merge changes
  what counts as live spend).

`next build` ✓, `eslint` 0. No migration, no test-suite change (PR3's
7-assertion block already covers the RPC contract).

Still deferred: statement (CSV/PDF) reconciliation;
rule `scope` / precedence / explainability; a "merged duplicates" section
on the canonical transaction's detail page.

---

## 11j. Phase U PR4 — as built (migration `20260923000000` + web)

Device management: a reversible **`paused`** state for
`ingestion_connections`, between `active` and the one-way `revoked`, plus
rename. Ingestion needed no change — `authenticateCredential` already
rejects any status other than `active`, so a paused device simply stops
sending until it is resumed, with its credential untouched.

- **Migration** — `ingestion_connections.paused_at` (nullable), the status
  CHECK widened to `('active', 'paused', 'revoked')`, and the
  status/timestamp consistency constraint replaced
  (`ingestion_connections_status_timestamps`): `active` has neither
  timestamp, `paused` has `paused_at` and no `revoked_at`, `revoked` has
  `revoked_at`. No new table / grant / function / policy — the existing
  `ingestion_connections_update_owner` RLS already scopes who can change
  this. Counters unchanged (71 / 115 / 71).
- **`connection-resolver.ts`** — the `IngestionConnectionRow.status` union
  widened to include `'paused'` (one line; behaviour already correct).
- **Web** — `getIngestionConnections` selects `paused_at`; new actions
  `pauseConnection` / `resumeConnection` / `renameConnection` (plain
  owner-scoped updates, same as `rotate`/`revoke`); `ConnectionItem` gains
  a "Paused" badge + explanation line, **Pause**/**Resume** and
  **Rename** (inline edit) controls. A paused connection hides "Rotate
  credential" (nothing to rotate while it can't be used) but keeps Rename
  and Revoke.
- **Migration test** — 4-assertion "Phase U PR4" block: owner pause,
  constraint rejects `paused` without `paused_at`, constraint rejects
  `active` with a lingering `paused_at`, owner resume. Full suite:
  **233 passed / 0 failed**. `deno check` / `deno test ingest-momo` (74) /
  `next build` / `eslint` all green.

Still deferred: statement (CSV/PDF) reconciliation; rule `scope` /
precedence / explainability; a "merged duplicates" section on the
canonical transaction's detail page.

---

## 11l. Phase U PR6 — as built (migration `20260924000000` + Deno)

Categorization-policy **scope**. A policy is `space`-scoped (default,
workspace-wide — unchanged) or `source`-scoped (applies only to
transactions from one `financial_source_id`). **Priority stays the
primary ordering**; scope is a within-tier ranking bump only, so a
deliberately high-priority space rule is never overridden by a narrower
one. Backend only — the policy-form scope selector is **PR6b (web)**.

- **Migration** — `categorization_policies.scope_type` (`'space'` default
  / `'source'`), `.scope_source_id` (nullable FK to `financial_sources`),
  a biconditional CHECK (`source` ⟺ `scope_source_id is not null`), a
  partial index on `scope_source_id`. `policy_matches_transaction()`
  (Phase G) re-issued (`create or replace`) with a leading scope clause:
  `scope_type <> 'source' or scope_source_id = txn.financial_source_id`
  (a `source` policy never matches a transaction with no source). No new
  table / grant / function / policy — counters unchanged (71 / 115 / 71).
- **`policy-engine.ts`** — `EvaluatePoliciesInput` gains
  `financialSourceId`; `matchesScope()` filters `source` policies before
  ranking; the sort is now
  `priority ↑, then source-before-space, then condition count`; the
  tied-for-best conflict group compares scope too; `buildExplanation()`
  appends "for this account" for a source match. `index.ts` passes the
  routed `resolvedFinancialSourceId`. The SQL/Deno sync comment now names
  both migrations.
- **Tests** — 3-assertion "Phase U PR6" migration block (scope-honouring
  match counts via `preview_policy_historical_match_count`, both CHECK
  rejections). Suite **236 passed / 0 failed**. `deno test ingest-momo`
  **78 passed** (+4 scope cases: source match isolation, source beats
  same-priority space, priority still beats scope, explanation text).
  `deno check` / `deno fmt` / `deno lint` green.

Still deferred: statement (CSV/PDF) reconciliation; **PR6b** — the
`PolicyForm` "applies to" selector (Space-wide vs a specific source) +
`getCategorizationPolicies` / `upsertPolicy` / `PolicyItem` plumbing.

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
