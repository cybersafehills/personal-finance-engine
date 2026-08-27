# ADR 0005: Households are a third `workspaces.kind`; financial-source visibility is explicit and is never conferred by membership

- **Status:** Proposed (OneLedger Spaces — Phase Q, design only)
- **Date:** 2026-08-27
- **Context:** Phase B (`20260821000000_phase_b_identity_and_tenancy.sql`)
  built a unified tenancy container — `workspaces` +
  `workspace_memberships` + `is_workspace_member()` — with
  `kind in ('personal','organization')` and roles
  `owner|admin|member|viewer`. Phase C
  (`20260827000000_organization_workspaces.sql`) shipped the mutation
  capability for `organization`: creation, bearer-token invites,
  role changes, removal, last-owner guard. To make a shared ledger the
  point of an organization, that migration **loosened**
  `accounts` / `transactions` / `merchant_rules` writes and reads from
  owner-only to any active member — i.e. **joining an organization
  workspace today exposes its entire ledger to the joiner.** The Spaces
  work introduces *Households*, whose members bring in *pre-existing
  personal financial sources* and must be able to share some, none, or
  only the transactions of each. The current "membership ⇒ full ledger"
  model is unsafe for that use case. Builds on ADR 0001 (non-custodial).

## Decision

### 1. A Household is `workspaces.kind = 'household'` — a third kind on the existing unified model, not a new tenancy system

`workspaces.kind` becomes `check (kind in ('personal','organization','household'))`.
There is **one** tenancy container, **one** membership table, **one**
authorization primitive. "Space" is the user-facing name for a
`workspace` row of any kind; the schema keeps the `workspace` term
(`workspace_id`, `workspace_memberships`, `is_workspace_member`) —
introducing a parallel `spaces` / `space_memberships` set of tables is
explicitly rejected (master prompt §2: "do not introduce two
semantically identical first-class concepts").

Consequences:

- `personal`, `organization`, and `household` are **permanently distinct**
  and have **no conversion path** between them — extending the rule Phase B
  already set for personal↔organization.
- `household` differs from `organization` only in: default copy and
  onboarding, the role→capability defaults (below), and that its members
  attach *individually-owned* financial sources rather than a
  workspace-owned ledger. Everything downstream that already keys off
  `workspace_id` (budgets, goals, rules, reports, review queue, AI facts)
  is `household`-ready with **no shape change** — the same reason Phase B
  declared `organization` before it was populated.
- `is_workspace_member(ws_id, min_role)` is unchanged. A future `business`
  kind slots in the same way.
- A new `create_household_workspace(p_name text)` RPC mirrors
  `create_organization_workspace` (SECURITY DEFINER, caller becomes sole
  owner). `handle_new_user()` is **not** touched — households are only
  ever user-created, never auto-provisioned.

### 2. Membership never confers visibility of a financial source. Visibility is a per-source, owner-set property.

A new `financial_sources` row has an `owner_user_id` (always a real
person, never a workspace) and a `visibility_mode`:

| `visibility_mode`     | Household members can see                              |
|-----------------------|-------------------------------------------------------|
| `personal_only`       | nothing — the source and its events stay in the owner's Personal Space |
| `share_transactions`  | transactions allocated to the Household, **not** balance or the full account feed |
| `share_account`       | transactions allocated to the Household **and** balance where the provider gives one |

Rules that follow from this:

- **Joining a Household shares nothing.** Every source a person already
  has defaults to `personal_only`. Bringing a source into a Household is
  an explicit, per-source, owner-only action taken *after* joining. This
  is a hard privacy rule (master prompt §10), enforced in RLS, not UI.
- The Phase C RLS loosening is **reverted for `household` workspaces**:
  `transactions` / balances are visible to a non-owning Household member
  only through an explicit `source_space_links` allocation whose source
  `visibility_mode` permits it — never through bare
  `is_workspace_member()`. `organization` workspaces keep the
  shared-ledger behaviour unchanged (their ledger is workspace-owned, not
  person-owned).
- A new SECURITY DEFINER / STABLE primitive
  `can_view_source_in_space(p_source_id uuid, p_workspace_id uuid)` —
  modelled exactly on `is_workspace_member()` and
  `has_directory_permission()` — is the single check every
  source-scoped and transaction-scoped RLS policy and RPC composes with
  the membership check. UI hiding is never the control.
- A source may be allocated to **more than one** Space over its life
  (Personal + Household, later + Business). `financial_sources` is owned
  by one person; `source_space_links` (source × workspace, with
  `visibility_mode` per link and an optional `default_space_id` routing
  hint) carries the allocation. `accounts` and `ingestion_connections`
  become *representations of* a `financial_source`, not the source
  concept itself — additive; no Phase C row is rewritten.
- **No retroactive exposure.** Historical transactions already in a
  person's Personal Space are not swept into a Household when a source is
  later shared; only events dated at/after the link's `effective_from`
  (owner-chosen, default = link creation) are eligible for Household
  allocation. Back-dating that boundary is a separate, audited owner
  action.

### 3. Attribution is recorded, not inferred, and is distinct from source ownership

Household `transactions` gain explicit, separately-nullable provenance:
`performed_by_user_id` (who did the spend), `attribution_type`
(`shared | member | split | unassigned`), and — for `member` —
`attributed_user_id`. `split` reuses the Phase E
`transaction_splits` table with per-member allocation. `source
owner` stays derivable from `financial_sources.owner_user_id` and is
**never** overwritten by attribution. When attribution cannot be
determined confidently, `unassigned` is used and the transaction surfaces
in the existing Phase G review queue — the system never guesses an
attributed member (master prompt §14, and this repo's standing "never
infer ownership from unstable values" rule).

## How this honours ADR 0001

- `financial_sources`, `source_space_links`, and the raw-event table
  added alongside them store provider, masked identifier, type, and
  visibility — **never** a PIN / OTP / password / credential / security
  answer. `ingestion_connections`' existing hash-only credential model is
  unchanged and remains the only place a secret is even referenced.
- "Available across shared accounts" on the Household dashboard is
  computed only from `share_account` sources that actually expose a
  provider balance; `share_transactions` sources contribute flows only.
  No figure is ever labelled a OneLedger-held balance.
- Nothing here moves money or adds a disbursement path.

## Consequences

- Phase Q ships **schema + primitives + RLS only**, no user-visible
  behaviour change, matching how every prior foundational phase (B, F, J)
  started. The Phase C shared-ledger revert applies to `household`
  workspaces, of which there are zero until Phase S.
- The migration-test privilege counters (`authenticated` table-grant and
  function-EXECUTE counts) rise by a known amount, with the reasoning
  block extended in the established Phase M/N/O/P style — the deliberate
  review checkpoint for privilege expansion.
- `getActiveWorkspaceId()` and the `active_workspace_id` cookie already
  handle "any number of workspaces, fall back to personal on revoked
  membership" — no change needed for households to appear in the
  switcher; the switcher UI upgrade and optional `/spaces/{id}/…` routes
  are Phase S, not a schema concern.
- A future `business` kind, cross-Space search, and per-field permissions
  remain possible without revisiting this ADR; implementing them is
  explicitly deferred (master prompt §75).
