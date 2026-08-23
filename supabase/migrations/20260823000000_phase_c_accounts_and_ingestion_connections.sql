-- Phase C: multi-account support and per-device ingestion connections.
--
-- Replaces the Phase B "single active account" ingestion assumption
-- (documented technical debt - see PHASE_4_PLANNING.md and ingest-momo's
-- own comments) with an explicit, credential-authenticated routing model:
--
--   ingestion credential -> ingestion_connections row -> workspace_id,
--   account_id (bound at connection-creation time, never re-derived from
--   a client-submitted value).
--
-- Purely additive: no existing column is dropped or retyped, no existing
-- row is touched. Safe to apply to production immediately.

-- ===========================================================================
-- accounts: multi-account lifecycle fields. is_active already existed
-- (Phase 3) and remains the canonical "usable right now" flag; archived_at
-- is new and records *when* an account was archived, for audit/history -
-- archiving an account never deletes it or its transactions (financial
-- history is preserved unconditionally, per standing project policy).
-- ===========================================================================

alter table public.accounts
  add column is_primary boolean not null default false,
  add column archived_at timestamptz;

comment on column public.accounts.is_primary is
  'At most one primary account per workspace (enforced below) - the account new UI surfaces default to when none is explicitly chosen. Not required to be set; a workspace may have zero primary accounts.';
comment on column public.accounts.archived_at is
  'When this account was archived (soft-lifecycle state, not deletion) - null while active. An archived account is never deleted; its historical transactions remain fully intact and queryable. Archiving an account with a connected ingestion_connections row does NOT reroute that connection to another account - it is left pointing at the archived account and ingestion through it is rejected (see ingest-momo), forcing an explicit reassignment rather than a silent account switch.';

-- At most one primary account per workspace. Partial index so multiple
-- non-primary accounts (is_primary = false) never conflict.
create unique index idx_accounts_one_primary_per_workspace
  on public.accounts (workspace_id)
  where is_primary;

-- Archiving must be internally consistent: is_active = false while
-- archived_at is set, and vice versa. Mirrors the same
-- is_resolved/resolved_at pairing pattern already used by
-- processing_errors_resolution_check.
alter table public.accounts
  add constraint accounts_archived_consistent_with_active check (
    (archived_at is null and is_active = true)
    or (archived_at is not null and is_active = false)
  );

-- accounts.workspace_id needs a UNIQUE(workspace_id, id) target for the
-- composite FK below (ingestion_connections_account_same_workspace) to
-- reference - id is already unique on its own (primary key), so this adds
-- no new real-world constraint, only the shape a composite FK requires.
-- Must exist before ingestion_connections is created, since that table's
-- own composite FK is declared inline at creation time.
alter table public.accounts
  add constraint accounts_workspace_id_id_unique unique (workspace_id, id);

-- ===========================================================================
-- ingestion_connections: one row per registered ingestion source ("Connect
-- your phone"). A connection is permanently bound to exactly one account
-- at creation time (the "bound account routing" model - see Phase C
-- architecture notes) - reassigning a connection to a different account is
-- an explicit, deliberate update to this row, never inferred.
-- ===========================================================================

create table public.ingestion_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  account_id uuid not null references public.accounts (id),
  label text not null check (length(trim(both from label)) > 0),
  provider text not null default 'mtn_momo'
    check (provider in ('mtn_momo', 'airtel_money', 'bank', 'other')),
  status text not null default 'active' check (status in ('active', 'revoked')),
  -- SHA-256 hex digest of the credential secret. The secret itself is
  -- never stored anywhere, in this table or any other - it is generated,
  -- shown to the user exactly once at creation/rotation time, and only
  -- ever compared by re-hashing an incoming request's presented value.
  credential_hash text not null unique,
  -- First 8 characters of the credential, stored only for the user's own
  -- benefit (so the Connections UI can show "pfe_ab12..." to help them
  -- recognize which physical device a listed connection corresponds to)
  -- - never sufficient on its own to authenticate or forge a request.
  credential_prefix text not null,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  constraint ingestion_connections_revoked_consistent_with_status check (
    (status = 'active' and revoked_at is null)
    or (status = 'revoked' and revoked_at is not null)
  ),
  -- The account a connection routes into must belong to the same
  -- workspace as the connection itself - a database-level guarantee that
  -- no connection can ever be pointed at another workspace's account,
  -- independent of and in addition to whatever application code checks.
  constraint ingestion_connections_account_same_workspace
    foreign key (workspace_id, account_id)
    references public.accounts (workspace_id, id)
);

comment on table public.ingestion_connections is
  'One row per registered ingestion source ("Connect your phone"). Replaces the Phase B single-active-account resolver: ingest-momo authenticates a request by hashing the presented credential and looking it up here, then resolves workspace_id/account_id directly from this row - never from anything the client submits.';
comment on column public.ingestion_connections.credential_hash is
  'SHA-256 hex digest of the credential secret. The plaintext secret is never persisted anywhere - shown once at creation/rotation, then only ever re-derived and compared, matching the pattern documented for future ingestion-source credentials in PHASE_4_PLANNING.md.';

create trigger set_ingestion_connections_updated_at
  before update on public.ingestion_connections
  for each row execute function public.set_updated_at();

create index idx_ingestion_connections_workspace
  on public.ingestion_connections (workspace_id, status);
create index idx_ingestion_connections_account
  on public.ingestion_connections (account_id);
-- credential_hash is already indexed by its UNIQUE constraint above -
-- this is the sole lookup path ingest-momo uses per request, so no
-- additional index is needed.

alter table public.ingestion_connections enable row level security;

-- ===========================================================================
-- RLS. Members can see their workspace's connections (never the credential
-- hash of another workspace's connection - RLS already prevents that row
-- from being visible at all). Only the owner may create/update/revoke a
-- connection. No delete policy - a connection is revoked, never deleted,
-- preserving provenance for any transaction ingested through it.
-- ===========================================================================

create policy ingestion_connections_select_member on public.ingestion_connections
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy ingestion_connections_write_owner on public.ingestion_connections
  for insert to authenticated
  with check (public.is_workspace_member(workspace_id, 'owner'));

create policy ingestion_connections_update_owner on public.ingestion_connections
  for update to authenticated
  using (public.is_workspace_member(workspace_id, 'owner'))
  with check (public.is_workspace_member(workspace_id, 'owner'));

revoke all on public.ingestion_connections from anon;
grant select, insert, update on public.ingestion_connections to authenticated;
grant select, insert, update, delete on public.ingestion_connections to service_role;

-- ===========================================================================
-- transactions: provenance. Records which ingestion connection actually
-- created a given transaction, for debugging/future reconciliation - not
-- exposed as a primary user-facing field. Nullable: the 37 existing
-- production transactions predate this concept entirely and are not
-- retroactively attributed to any connection (there is no evidence-based
-- way to do so, and guessing would violate the project's standing "never
-- infer ownership from unstable values" rule).
-- ===========================================================================

alter table public.transactions
  add column ingestion_connection_id uuid references public.ingestion_connections (id);

create index idx_transactions_ingestion_connection
  on public.transactions (ingestion_connection_id);
