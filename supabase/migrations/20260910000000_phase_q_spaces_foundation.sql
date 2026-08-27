-- Phase Q: OneLedger Spaces foundation - household Space kind, the
-- person-owned financial-source model, per-source visibility, the raw
-- financial-event upstream, and the collaboration primitives (activity,
-- audit, per-member notification prefs, Space-scoped categories).
--
-- Design of record: docs/oneledger-spaces-design.md.
-- Decision record:  docs/adr/0005-spaces-tenancy-and-source-visibility.md.
--
-- Purely additive. Every new column is nullable-first (or NOT NULL with a
-- constant default, which Postgres 11+ applies without a table rewrite);
-- every new table is new; no existing row is modified. The companion
-- migration 20260911000000_phase_q_spaces_backfill_and_constraints.sql is
-- what creates a financial_sources row per existing account and links
-- them (accounts/transactions .financial_source_id stay nullable - the
-- app's account-creation and ingestion write paths do not set them yet;
-- Phase S/U add the NOT NULL constraints) - kept apart so this file can be
-- applied, verified, and left running before that step, exactly like the
-- Phase B identity/backfill and Phase 3 accounting-column splits.
--
-- There are zero kind='household' workspaces until Phase S creates the
-- first one, so every household-specific policy branch and every new
-- authorization primitive below is inert on application - this migration
-- changes schema and RLS shape, never observable behaviour for the
-- personal/organization workspaces that exist today.

-- ===========================================================================
-- workspaces.kind: add 'household' as a third, permanently-distinct kind.
-- personal <-> organization already have no conversion path (Phase B);
-- household joins them under the same rule. Nothing downstream that keys
-- off workspace_id needs a shape change - the same reason Phase B declared
-- 'organization' years before it was populated.
-- ===========================================================================

alter table public.workspaces drop constraint workspaces_kind_check;
alter table public.workspaces add constraint workspaces_kind_check
  check (kind in ('personal', 'organization', 'household'));

comment on column public.workspaces.kind is
  'personal (auto-provisioned, one per user, never converts), organization (user-created shared ledger - fully shared among members), household (user-created - members attach individually-owned financial_sources and choose per-source what the Space may see). Permanently distinct; no conversion path between any two.';

-- create_household_workspace: the household counterpart of Phase C's
-- create_organization_workspace. Caller becomes sole owner. Currency and
-- timezone are inherited from the creator's profile (a Household is "ours"
-- and should open already speaking the creator's money and clock), with
-- the same workspace-column defaults as a fallback. handle_new_user() is
-- deliberately NOT touched - households are only ever user-created.
create or replace function public.create_household_workspace(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workspace_id uuid;
begin
  insert into public.workspaces (kind, name, default_currency, timezone, created_by)
  values (
    'household',
    p_name,
    coalesce((select preferred_currency from public.profiles where id = auth.uid()), 'RWF'),
    coalesce((select timezone from public.profiles where id = auth.uid()), 'Africa/Kigali'),
    auth.uid()
  )
  returning id into v_workspace_id;

  insert into public.workspace_memberships (workspace_id, user_id, role, status, joined_at)
  values (v_workspace_id, auth.uid(), 'owner', 'active', now());

  return v_workspace_id;
end;
$$;

comment on function public.create_household_workspace is
  'Creates a household workspace with the caller as its sole owner, inheriting currency/timezone from the caller''s profile. Mirrors create_organization_workspace - personal workspaces stay exclusively provisioned by handle_new_user() at signup.';

revoke all on function public.create_household_workspace(text) from public;
grant execute on function public.create_household_workspace(text) to authenticated;

-- ===========================================================================
-- financial_sources: a source of financial events, owned by exactly one
-- PERSON (never a workspace). Distinct from `accounts`, which remains the
-- per-Space representation (balance, primary flag, archival). One person's
-- source can, over its life, feed more than one Space (Personal + a
-- Household, later + a Business) - the allocation lives in
-- source_space_links below, not on the source.
--
-- visibility_mode is the source owner's ceiling on what ANY collaborative
-- Space may ever see of this source. Its default, personal_only, is the
-- hard privacy rule from ADR 0005 S2 / master prompt S10: joining a
-- Household shares nothing; every share is a later, explicit, per-source,
-- owner-only act.
-- ===========================================================================

create table public.financial_sources (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null
    check (provider in ('mtn_momo', 'airtel_money', 'bank', 'card', 'cash', 'statement', 'other')),
  source_type text not null
    check (source_type in ('mobile_money', 'bank_account', 'card', 'cash', 'import')),
  display_name text not null check (length(trim(both from display_name)) > 0),
  currency char(3) not null default 'RWF' check (currency = upper(currency)),
  -- Never a full account/phone number. '•••• 482', 'MTN ...4821', etc.
  masked_identifier text,
  visibility_mode text not null default 'personal_only'
    check (visibility_mode in ('personal_only', 'share_transactions', 'share_account')),
  status text not null default 'active' check (status in ('active', 'paused', 'archived')),
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.financial_sources is
  'A person-owned source of financial events (mobile money account, bank account, card, cash, an imported statement). owner_user_id is always a real user, never a workspace. visibility_mode is the owner-set ceiling on what any collaborative Space may see; personal_only (the default) means no Space sees anything - sharing is always a later explicit act via source_space_links.';
comment on column public.financial_sources.visibility_mode is
  'personal_only: no collaborative Space sees this source or its events. share_transactions: eligible members of a linked Space see transactions allocated to that Space, not balance. share_account: also balance, where the provider exposes one.';

create index idx_financial_sources_owner on public.financial_sources (owner_user_id, status);

create trigger set_financial_sources_updated_at
  before update on public.financial_sources
  for each row execute function public.set_updated_at();

alter table public.financial_sources enable row level security;

-- ===========================================================================
-- source_space_links: the allocation of one financial source into one
-- collaborative Space, with a per-link visibility mode (which may be
-- narrower than, never wider than, the source's own ceiling - enforced by
-- the owner-only write RPCs in Phase S, not here). effective_from is the
-- no-retroactive-exposure boundary: no event dated before it is ever
-- allocable to this Space (ADR 0005 S2). A source's implicit link to its
-- owner's Personal Space is NOT stored here - this table holds only the
-- additional, collaborative allocations.
-- ===========================================================================

create table public.source_space_links (
  id uuid primary key default gen_random_uuid(),
  financial_source_id uuid not null references public.financial_sources (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  visibility_mode text not null
    check (visibility_mode in ('share_transactions', 'share_account')),
  -- New canonical transactions from this source route to the Space of its
  -- one is_default_target link, else the owner's Personal Space.
  is_default_target boolean not null default false,
  effective_from timestamptz not null default now(),
  status text not null default 'active' check (status in ('active', 'paused', 'revoked')),
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint source_space_links_unique unique (financial_source_id, workspace_id)
);

comment on table public.source_space_links is
  'Allocation of a financial_source into a collaborative Space. Absence of a row = the source is personal_only for that Space. status=active is the only sharing state; paused/revoked stop future allocation and immediately hide Space-allocated history from non-owning members (the owner keeps everything in their Personal Space).';

-- At most one default routing target per source.
create unique index idx_source_space_links_one_default
  on public.source_space_links (financial_source_id)
  where is_default_target and status = 'active';
create index idx_source_space_links_workspace
  on public.source_space_links (workspace_id, status);

create trigger set_source_space_links_updated_at
  before update on public.source_space_links
  for each row execute function public.set_updated_at();

alter table public.source_space_links enable row level security;

-- ===========================================================================
-- Authorization primitives. All three mirror is_workspace_member()
-- exactly: SECURITY DEFINER (so they read financial_sources /
-- source_space_links / workspace_memberships regardless of the calling
-- role's own RLS visibility, which also means no policy that calls them
-- can recurse), STABLE, search_path pinned. Each needs its own explicit
-- grant to authenticated - a SECURITY DEFINER function invoked from an
-- RLS policy still runs an EXECUTE permission check against the *calling*
-- role (the Phase L is_valid_nav_order incident; see migrations/README.md).
-- ===========================================================================

-- owns_financial_source: is auth.uid() the owner of this source?
create or replace function public.owns_financial_source(p_source_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.financial_sources s
    where s.id = p_source_id and s.owner_user_id = auth.uid()
  );
$$;

comment on function public.owns_financial_source is
  'Authorization primitive: is the current auth.uid() the owner of financial source p_source_id. SECURITY DEFINER + STABLE.';

revoke all on function public.owns_financial_source(uuid) from public;
grant execute on function public.owns_financial_source(uuid) to authenticated, service_role;

-- is_financial_source_visible: may auth.uid() see this source AT ALL, in
-- any Space they belong to? Used by financial_sources' own SELECT policy.
create or replace function public.is_financial_source_visible(p_source_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    public.owns_financial_source(p_source_id)
    or exists (
      select 1
      from public.source_space_links l
      join public.workspace_memberships m
        on m.workspace_id = l.workspace_id
       and m.user_id = auth.uid()
       and m.status = 'active'
      where l.financial_source_id = p_source_id
        and l.status = 'active'
        and l.visibility_mode in ('share_transactions', 'share_account')
    );
$$;

comment on function public.is_financial_source_visible is
  'Authorization primitive: may the current auth.uid() see financial source p_source_id at all - true if they own it, or it is actively shared into any Space they are an active member of. SECURITY DEFINER + STABLE.';

revoke all on function public.is_financial_source_visible(uuid) from public;
grant execute on function public.is_financial_source_visible(uuid) to authenticated, service_role;

-- can_view_source_in_space: may auth.uid() see this source's data WITHIN
-- this specific Space? The single check every transaction- and
-- account-scoped RLS policy composes with membership.
--
-- For personal/organization Spaces it collapses to is_workspace_member()
-- (their ledgers are workspace-owned and fully shared - Phase C), so the
-- re-issued accounts/transactions policies below are byte-equivalent to
-- today's behaviour for every workspace that currently exists.
--
-- For a household Space it is true only if the caller owns the source or
-- the source is actively shared into that Space. A NULL p_source_id in a
-- household Space yields false - a household transaction must always carry
-- a source (the Phase Q backfill leaves transactions.financial_source_id
-- nullable for the personal/organization rows that predate it; Phase U's
-- ingestion cutover makes it NOT NULL once every writer sets it).
create or replace function public.can_view_source_in_space(
  p_source_id uuid,
  p_workspace_id uuid
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    public.is_workspace_member(p_workspace_id)
    and (
      coalesce((select kind from public.workspaces where id = p_workspace_id), '') <> 'household'
      or public.owns_financial_source(p_source_id)
      or exists (
        select 1 from public.source_space_links l
        where l.financial_source_id = p_source_id
          and l.workspace_id = p_workspace_id
          and l.status = 'active'
          and l.visibility_mode in ('share_transactions', 'share_account')
      )
    );
$$;

comment on function public.can_view_source_in_space is
  'Authorization primitive: may the current auth.uid() see data for financial source p_source_id within workspace p_workspace_id. Collapses to is_workspace_member() for personal/organization workspaces; for household workspaces additionally requires source ownership or an active share link. SECURITY DEFINER + STABLE.';

revoke all on function public.can_view_source_in_space(uuid, uuid) from public;
grant execute on function public.can_view_source_in_space(uuid, uuid) to authenticated, service_role;

-- ===========================================================================
-- financial_sources / source_space_links RLS.
-- ===========================================================================

-- A source is visible to its owner, and to a member of any Space it is
-- actively shared into. Only the owner may create or modify it. No delete
-- policy - archival is status='archived', preserving provenance for every
-- transaction ever attributed to it.
--
-- The owner branch is a bare column comparison, deliberately kept ahead
-- of the function call: INSERT ... RETURNING re-checks the SELECT policy
-- against the just-inserted row, and a STABLE SECURITY DEFINER function
-- does not see that row mid-statement (it would make every
-- `insert ... returning id` by the owner fail RLS). The plain
-- owner_user_id = auth.uid() check passes directly against the candidate
-- row. is_financial_source_visible() still covers the non-owner
-- shared-Space case, where RETURNING never applies.
create policy financial_sources_select_visible on public.financial_sources
  for select to authenticated
  using (
    owner_user_id = auth.uid()
    or public.is_financial_source_visible(id)
  );

create policy financial_sources_insert_owner on public.financial_sources
  for insert to authenticated
  with check (owner_user_id = auth.uid());

create policy financial_sources_update_owner on public.financial_sources
  for update to authenticated
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

-- A link is visible to the source owner and to any active member of the
-- linked Space (a member needs to know which of a co-member's sources
-- feed this Space). Only the source owner may create or modify a link,
-- and only into a Space they are themselves an active member of. No
-- delete policy - status carries paused/revoked.
create policy source_space_links_select on public.source_space_links
  for select to authenticated
  using (
    public.owns_financial_source(financial_source_id)
    or public.is_workspace_member(workspace_id)
  );

create policy source_space_links_insert_owner on public.source_space_links
  for insert to authenticated
  with check (
    public.owns_financial_source(financial_source_id)
    and public.is_workspace_member(workspace_id, 'member')
  );

create policy source_space_links_update_owner on public.source_space_links
  for update to authenticated
  using (public.owns_financial_source(financial_source_id))
  with check (public.owns_financial_source(financial_source_id));

revoke all on public.financial_sources, public.source_space_links from anon;
grant select, insert, update on public.financial_sources to authenticated;
grant select, insert, update on public.source_space_links to authenticated;
grant select, insert, update, delete on public.financial_sources to service_role;
grant select, insert, update, delete on public.source_space_links to service_role;

-- ===========================================================================
-- accounts.financial_source_id / transactions.financial_source_id: the
-- link from the per-Space representation and the canonical ledger row to
-- the person-owned source. Nullable here; the companion backfill migration
-- creates a source per existing account and sets accounts.financial_source_id
-- NOT NULL. transactions.financial_source_id stays nullable through Phase Q
-- (see can_view_source_in_space's comment).
-- ===========================================================================

alter table public.accounts
  add column financial_source_id uuid references public.financial_sources (id);

alter table public.transactions
  add column financial_source_id uuid references public.financial_sources (id);

create index idx_accounts_financial_source on public.accounts (financial_source_id);
create index idx_transactions_financial_source on public.transactions (financial_source_id);

-- ===========================================================================
-- transactions: household attribution + provenance. All nullable/additive.
-- Distinct columns, never one ambiguous user_id (master prompt S14):
--   performed_by_user_id      - who actually did the spend
--   record_created_by_user_id - who created the OneLedger record (manual entry)
--   attribution_type          - whose/which financial behaviour this represents
--   attributed_user_id        - the member, when attribution_type='member'
-- Source ownership stays derivable from financial_sources.owner_user_id and
-- is never written here. attribution_type='split' is declared now; the
-- per-member split rows are Phase S (transaction_splits, as it exists
-- today, is budget-allocation splitting - a different axis).
-- ===========================================================================

alter table public.transactions
  add column performed_by_user_id uuid references auth.users (id),
  add column record_created_by_user_id uuid references auth.users (id),
  add column attribution_type text
    check (attribution_type is null
           or attribution_type in ('shared', 'member', 'split', 'unassigned')),
  add column attributed_user_id uuid references auth.users (id),
  add column allocation_status text not null default 'allocated'
    check (allocation_status in ('allocated', 'needs_space', 'needs_attribution'));

alter table public.transactions
  add constraint transactions_attributed_user_only_when_member check (
    attribution_type is distinct from 'member' or attributed_user_id is not null
  );

comment on column public.transactions.attribution_type is
  'household Spaces only: shared (household-level spend) | member (attributed to attributed_user_id) | split (divided across members - Phase S) | unassigned (could not be determined; surfaces in the review queue - the system never guesses a member). NULL for personal/organization transactions.';
comment on column public.transactions.allocation_status is
  'allocated (normal) | needs_space (ingested but Space could not be resolved) | needs_attribution (household transaction awaiting attribution). The two needs_* states surface in the Phase G review queue.';

create index idx_transactions_attribution
  on public.transactions (workspace_id, attribution_type);
create index idx_transactions_allocation_review
  on public.transactions (workspace_id)
  where allocation_status <> 'allocated';

-- ===========================================================================
-- accounts / transactions RLS: re-issued to compose membership with
-- can_view_source_in_space(). Byte-equivalent to the Phase C policies for
-- every personal/organization workspace (the new primitive collapses to
-- is_workspace_member there); adds the per-source visibility gate for
-- household workspaces, of which none exist yet.
-- ===========================================================================

drop policy accounts_select_member on public.accounts;
create policy accounts_select_member on public.accounts
  for select to authenticated
  using (
    workspace_id is not null
    and public.can_view_source_in_space(financial_source_id, workspace_id)
  );

drop policy accounts_write_member on public.accounts;
create policy accounts_write_member on public.accounts
  for insert to authenticated
  with check (
    public.is_workspace_member(workspace_id, 'member')
    and public.can_view_source_in_space(financial_source_id, workspace_id)
  );

drop policy accounts_update_member on public.accounts;
create policy accounts_update_member on public.accounts
  for update to authenticated
  using (
    public.is_workspace_member(workspace_id, 'member')
    and public.can_view_source_in_space(financial_source_id, workspace_id)
  )
  with check (
    public.is_workspace_member(workspace_id, 'member')
    and public.can_view_source_in_space(financial_source_id, workspace_id)
  );

drop policy transactions_select_member on public.transactions;
create policy transactions_select_member on public.transactions
  for select to authenticated
  using (
    workspace_id is not null
    and public.can_view_source_in_space(financial_source_id, workspace_id)
  );

drop policy transactions_update_categorize_member on public.transactions;
create policy transactions_update_categorize_member on public.transactions
  for update to authenticated
  using (
    public.is_workspace_member(workspace_id, 'member')
    and public.can_view_source_in_space(financial_source_id, workspace_id)
  )
  with check (
    public.is_workspace_member(workspace_id, 'member')
    and public.can_view_source_in_space(financial_source_id, workspace_id)
  );

-- ===========================================================================
-- raw_financial_events: what the system actually received, upstream of the
-- normalized canonical `transactions` row. Evidence is never discarded on
-- normalization or merge (master prompt S12/S16). Service-role-only, like
-- momo_messages / processing_errors - an authenticated user never reads
-- raw events directly; provenance is surfaced on the transaction. RLS is
-- enabled with no authenticated policy (deny-by-default), so this table is
-- NOT the documented auth_login_attempts exception.
-- ===========================================================================

create table public.raw_financial_events (
  id uuid primary key default gen_random_uuid(),
  financial_source_id uuid references public.financial_sources (id),
  ingestion_connection_id uuid references public.ingestion_connections (id),
  channel text not null
    check (channel in ('sms', 'bank_api', 'email', 'statement', 'receipt', 'manual')),
  received_at timestamptz not null,
  -- Dedupe of the EVIDENCE, not the transaction - the same SMS delivered
  -- twice by two devices hashes once here; transaction-level dedupe
  -- (amount/counterparty/time fingerprinting) is Phase U.
  payload_hash text not null unique,
  raw_payload jsonb not null default '{}'::jsonb,
  parse_status text not null default 'pending'
    check (parse_status in ('pending', 'normalized', 'rejected', 'superseded')),
  canonical_transaction_id uuid references public.transactions (id),
  parser_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.raw_financial_events is
  'The raw evidence OneLedger received from an ingestion channel, upstream of the normalized `transactions` row it produces (canonical_transaction_id). Never discarded on normalization or duplicate-merge. Service-role-only: written by ingestion, never read directly by an authenticated user.';

create index idx_raw_financial_events_parse_status
  on public.raw_financial_events (parse_status);
create index idx_raw_financial_events_source
  on public.raw_financial_events (financial_source_id, received_at desc);
create index idx_raw_financial_events_canonical
  on public.raw_financial_events (canonical_transaction_id);

create trigger set_raw_financial_events_updated_at
  before update on public.raw_financial_events
  for each row execute function public.set_updated_at();

alter table public.raw_financial_events enable row level security;

revoke all on public.raw_financial_events from anon;
grant select, insert, update, delete on public.raw_financial_events to service_role;

-- ===========================================================================
-- space_activity: the human-readable collaborative history a Space member
-- reads ("Alice joined", "Dolton changed the Groceries budget", "August
-- statement imported"). Append-only. Written by SECURITY DEFINER RPCs in
-- Phase R/S, never directly by an authenticated user - hence SELECT-only
-- for authenticated.
-- ===========================================================================

create table public.space_activity (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  actor_user_id uuid references auth.users (id),
  kind text not null,
  summary text not null,
  ref_type text,
  ref_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.space_activity is
  'Human-readable per-Space collaborative feed. Append-only. Distinct from space_audit_events, which is the protected technical record - this is the friendly narration and carries no old/new values or request metadata.';

create index idx_space_activity_workspace
  on public.space_activity (workspace_id, created_at desc);

alter table public.space_activity enable row level security;

create policy space_activity_select_member on public.space_activity
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

revoke all on public.space_activity from anon;
grant select on public.space_activity to authenticated;
grant select, insert, update, delete on public.space_activity to service_role;

-- ===========================================================================
-- space_audit_events: the protected technical record. Same shape as
-- payment_audit_events / service_directory_audit_events. Append-only,
-- owner/admin-readable only, written by SECURITY DEFINER RPCs. Sensitive
-- old/new values and request metadata live here, never in space_activity.
-- ===========================================================================

create table public.space_audit_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  actor_user_id uuid references auth.users (id),
  event_type text not null,
  resource_type text not null,
  resource_id uuid,
  old_value jsonb,
  new_value jsonb,
  ip inet,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.space_audit_events is
  'Protected per-Space audit trail for the sensitive-action list in master prompt S61 (invites, role changes, ownership transfer, source-sharing changes, budget/goal/rule changes, transaction reassignment/attribution changes, duplicate merges, archive/delete, security-setting changes). Append-only; owner/admin read only.';

create index idx_space_audit_events_workspace
  on public.space_audit_events (workspace_id, created_at desc);
create index idx_space_audit_events_resource
  on public.space_audit_events (resource_type, resource_id);

alter table public.space_audit_events enable row level security;

create policy space_audit_events_select_admin on public.space_audit_events
  for select to authenticated
  using (public.is_workspace_member(workspace_id, 'admin'));

revoke all on public.space_audit_events from anon;
grant select on public.space_audit_events to authenticated;
grant select, insert, update, delete on public.space_audit_events to service_role;

-- ===========================================================================
-- space_member_notification_prefs: each member controls their own Space
-- notification preferences (master prompt S37). A row's absence means
-- "use the default for this event/channel". Security-notable events
-- (S38) ignore enabled=false at dispatch time - that is a delivery-layer
-- rule (Phase T), not a constraint here.
-- ===========================================================================

create table public.space_member_notification_prefs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  event_key text not null,
  channel text not null check (channel in ('in_app', 'email')),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint space_member_notification_prefs_unique
    unique (workspace_id, user_id, event_key, channel)
);

comment on table public.space_member_notification_prefs is
  'Per-member, per-Space notification preferences. Absence of a row = the event/channel default. Channels limited to in_app and email (Resend, already wired); push/SMS are deferred.';

create index idx_space_member_notification_prefs_lookup
  on public.space_member_notification_prefs (workspace_id, user_id);

create trigger set_space_member_notification_prefs_updated_at
  before update on public.space_member_notification_prefs
  for each row execute function public.set_updated_at();

alter table public.space_member_notification_prefs enable row level security;

-- A member reads and writes only their own preference rows, and only in a
-- Space they are an active member of. Delete is allowed (reset to default).
create policy space_member_notification_prefs_select_own
  on public.space_member_notification_prefs
  for select to authenticated
  using (user_id = auth.uid() and public.is_workspace_member(workspace_id));

create policy space_member_notification_prefs_insert_own
  on public.space_member_notification_prefs
  for insert to authenticated
  with check (user_id = auth.uid() and public.is_workspace_member(workspace_id));

create policy space_member_notification_prefs_update_own
  on public.space_member_notification_prefs
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy space_member_notification_prefs_delete_own
  on public.space_member_notification_prefs
  for delete to authenticated
  using (user_id = auth.uid());

revoke all on public.space_member_notification_prefs from anon;
grant select, insert, update, delete
  on public.space_member_notification_prefs to authenticated;
grant select, insert, update, delete
  on public.space_member_notification_prefs to service_role;

-- ===========================================================================
-- workspace_categories: Space-scoped category customization (master prompt
-- S27). Platform categories remain the shared default (the free-text
-- category/subcategory on transactions, plus merchant_rules); this table
-- lets a Household add or relabel categories without touching any member's
-- Personal categories. member-readable, admin-writable.
-- ===========================================================================

create table public.workspace_categories (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  key text not null,
  label text not null check (length(trim(both from label)) > 0),
  parent_key text,
  is_archived boolean not null default false,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspace_categories_unique_key unique (workspace_id, key)
);

comment on table public.workspace_categories is
  'Space-scoped category additions/relabels. Orthogonal to the platform category set; a workspace renaming or adding a category here never affects another Space or any member''s Personal categories.';

create index idx_workspace_categories_workspace
  on public.workspace_categories (workspace_id)
  where not is_archived;

create trigger set_workspace_categories_updated_at
  before update on public.workspace_categories
  for each row execute function public.set_updated_at();

alter table public.workspace_categories enable row level security;

create policy workspace_categories_select_member on public.workspace_categories
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy workspace_categories_insert_admin on public.workspace_categories
  for insert to authenticated
  with check (public.is_workspace_member(workspace_id, 'admin'));

create policy workspace_categories_update_admin on public.workspace_categories
  for update to authenticated
  using (public.is_workspace_member(workspace_id, 'admin'))
  with check (public.is_workspace_member(workspace_id, 'admin'));

revoke all on public.workspace_categories from anon;
grant select, insert, update on public.workspace_categories to authenticated;
grant select, insert, update, delete on public.workspace_categories to service_role;
