-- Integrations Phase 2, P2-PR1: the outbound / bidirectional layer -
-- destinations, connected workbooks, synchronization runs, and conflicts.
--
-- The Phase 1 ingestion connector model (connector_installations +
-- _shared/connector-adapter.ts) is inbound-only. This is the parallel
-- outbound layer, following the same conventions as the Phase 1
-- Integrations tables (20261027000000): RLS SELECT gated on
-- integration.view; every write goes through a service-role client or a
-- capability-gated SECURITY DEFINER RPC; integration_events is the
-- activity/audit surface. Secrets live in a service-role-only table with
-- zero authenticated/anon grants.

-- ===========================================================================
-- 1. Capability catalog: +3 (owner/admin only, never member). Forward-only
--    replace of the function body + the additive grant CHECK, exactly as
--    20261026000000 did.
-- ===========================================================================
create or replace function public.space_role_has_capability(
  p_kind text,
  p_role text,
  p_capability text
)
returns boolean
language sql
immutable
as $$
  select coalesce(
    p_capability in (
      'space.manage_settings', 'space.delete', 'space.transfer_ownership',
      'members.manage', 'budget.manage', 'goal.manage', 'rule.manage',
      'report.config', 'category.manage', 'transaction.create',
      'transaction.categorize', 'audit.view',
      'integration.view', 'integration.import', 'integration.import_approve',
      'integration.export', 'integration.configure',
      'integration.connection_manage', 'integration.sync_manage',
      'integration.logs_view',
      'integration.destination_manage', 'integration.workbook_manage',
      'integration.conflict_resolve'
    )
    and case
      when p_kind = 'personal' then p_role = 'owner'
      when p_role = 'owner' then true
      when p_role = 'admin'
        then p_capability not in ('space.delete', 'space.transfer_ownership')
      when p_role = 'member'
        then p_capability in (
          'transaction.create', 'transaction.categorize', 'integration.view'
        )
      else false
    end,
    false
  );
$$;

comment on function public.space_role_has_capability is
  'Closed Spaces capability matrix. Unknown and null capabilities always fail closed. Owner: all 23 known capabilities. Admin: all except space.delete / space.transfer_ownership. Member: transaction.create / transaction.categorize / integration.view. Viewer: none.';

alter table public.space_member_capability_grants
  drop constraint if exists space_member_capability_grants_known_capability;

alter table public.space_member_capability_grants
  add constraint space_member_capability_grants_known_capability
  check (capability in (
    'space.manage_settings', 'space.delete', 'space.transfer_ownership',
    'members.manage', 'budget.manage', 'goal.manage', 'rule.manage',
    'report.config', 'category.manage', 'transaction.create',
    'transaction.categorize', 'audit.view',
    'integration.view', 'integration.import', 'integration.import_approve',
    'integration.export', 'integration.configure',
    'integration.connection_manage', 'integration.sync_manage',
    'integration.logs_view',
    'integration.destination_manage', 'integration.workbook_manage',
    'integration.conflict_resolve'
  )) not valid;

alter table public.space_member_capability_grants
  validate constraint space_member_capability_grants_known_capability;

-- ===========================================================================
-- 2. integration_destinations: where an export / sync result is delivered.
-- ===========================================================================
create table public.integration_destinations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (length(trim(both from name)) > 0),
  kind text not null check (kind in (
    'download', 'webhook', 'cloud_storage', 'connected_workbook'
  )),
  -- null for download/webhook; a provider key for the others.
  provider text check (provider in (
    'google_drive', 'onedrive', 'dropbox', 'google_sheets', 'excel_365',
    'custom'
  )),
  -- redacted: folder path, sheet map, webhook URL - never a secret.
  config jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in (
    'active', 'needs_auth', 'error', 'disabled'
  )),
  last_delivery_at timestamptz,
  last_error_code text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integration_destinations_unique_name unique (workspace_id, name)
);

comment on table public.integration_destinations is
  'An outbound delivery target for exports / sync results (download, signed webhook, cloud-storage folder, or a connected workbook). config is redacted - secrets live in integration_destination_secrets.';

create index idx_integration_destinations_workspace
  on public.integration_destinations (workspace_id, status);

create trigger set_integration_destinations_updated_at
  before update on public.integration_destinations
  for each row execute function public.set_updated_at();

alter table public.integration_destinations enable row level security;

create policy integration_destinations_select_member on public.integration_destinations
  for select to authenticated
  using (public.has_space_capability(workspace_id, 'integration.view'));

revoke all on public.integration_destinations from anon;
grant select on public.integration_destinations to authenticated;
grant select, insert, update, delete on public.integration_destinations to service_role;

-- ===========================================================================
-- 3. integration_destination_secrets: service-role only, ZERO
--    authenticated/anon access (same model as email_send_log /
--    report_artifacts). Holds the hashed webhook signing secret and, later,
--    encrypted OAuth tokens.
-- ===========================================================================
create table public.integration_destination_secrets (
  destination_id uuid primary key
    references public.integration_destinations (id) on delete cascade,
  -- 'webhook_hmac' | 'oauth_token'
  secret_kind text not null check (secret_kind in ('webhook_hmac', 'oauth_token')),
  -- SHA-256 hex of the reveal-once webhook secret, OR an encrypted token blob.
  secret_material text not null,
  secret_prefix text,
  rotated_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.integration_destination_secrets is
  'Secret material for integration_destinations. service_role-only: written by the destinations actions, read by the delivery cron. No authenticated/anon grants at all - never user-facing.';

create trigger set_integration_destination_secrets_updated_at
  before update on public.integration_destination_secrets
  for each row execute function public.set_updated_at();

alter table public.integration_destination_secrets enable row level security;

revoke all on public.integration_destination_secrets from anon, authenticated;
grant select, insert, update, delete on public.integration_destination_secrets to service_role;

-- ===========================================================================
-- 4. connected_workbooks: a persistent association between OneLedger and an
--    external spreadsheet.
-- ===========================================================================
create table public.connected_workbooks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  destination_id uuid not null
    references public.integration_destinations (id) on delete cascade,
  -- opaque provider handle (a Sheets id, a stored-file path, ...).
  external_ref text,
  -- { transactions: 'Transactions', expenses: 'Expenses', ... }
  sheet_map jsonb not null default '{}'::jsonb,
  direction text not null default 'export' check (direction in (
    'export', 'import', 'two_way'
  )),
  -- OneLedger stays authoritative by default (ADR / master prompt §24).
  source_of_truth text not null default 'oneledger'
    check (source_of_truth in ('oneledger', 'external')),
  last_sync_run_id uuid,
  status text not null default 'active' check (status in (
    'active', 'paused', 'needs_auth', 'error', 'disconnected'
  )),
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.connected_workbooks is
  'A persistent link between OneLedger and an external spreadsheet. Default direction=export, source_of_truth=oneledger; inbound changes never write the ledger directly - they land in integration_conflicts / staging for review.';

create index idx_connected_workbooks_workspace
  on public.connected_workbooks (workspace_id, status);
create index idx_connected_workbooks_destination
  on public.connected_workbooks (destination_id);

create trigger set_connected_workbooks_updated_at
  before update on public.connected_workbooks
  for each row execute function public.set_updated_at();

alter table public.connected_workbooks enable row level security;

create policy connected_workbooks_select_member on public.connected_workbooks
  for select to authenticated
  using (public.has_space_capability(workspace_id, 'integration.view'));

revoke all on public.connected_workbooks from anon;
grant select on public.connected_workbooks to authenticated;
grant select, insert, update, delete on public.connected_workbooks to service_role;

-- ===========================================================================
-- 5. integration_sync_runs: one traceable execution of a delivery / sync.
-- ===========================================================================
create table public.integration_sync_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  destination_id uuid references public.integration_destinations (id) on delete set null,
  connected_workbook_id uuid references public.connected_workbooks (id) on delete set null,
  export_job_id uuid references public.export_jobs (id) on delete set null,
  trigger text not null check (trigger in ('manual', 'scheduled', 'webhook', 'poll')),
  direction text not null default 'export' check (direction in (
    'export', 'import', 'two_way'
  )),
  status text not null default 'queued' check (status in (
    'queued', 'running', 'succeeded', 'partial', 'failed'
  )),
  cursor_before text,
  cursor_after text,
  -- { read, created, updated, skipped, needs_review, failed }
  counts jsonb not null default '{}'::jsonb,
  error jsonb,
  attempt integer not null default 0 check (attempt >= 0),
  next_attempt_at timestamptz,
  claim_token uuid,
  claimed_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.integration_sync_runs is
  'One traceable delivery / sync execution against a destination or connected workbook. Persists counts, cursor movement and retry state; carries no raw provider payloads.';

create index idx_integration_sync_runs_workspace
  on public.integration_sync_runs (workspace_id, created_at desc);
create index idx_integration_sync_runs_destination
  on public.integration_sync_runs (destination_id, created_at desc);
create index idx_integration_sync_runs_pending
  on public.integration_sync_runs (status, next_attempt_at)
  where status in ('queued', 'running');

create trigger set_integration_sync_runs_updated_at
  before update on public.integration_sync_runs
  for each row execute function public.set_updated_at();

alter table public.integration_sync_runs enable row level security;

create policy integration_sync_runs_select_member on public.integration_sync_runs
  for select to authenticated
  using (public.has_space_capability(workspace_id, 'integration.view'));

revoke all on public.integration_sync_runs from anon;
grant select on public.integration_sync_runs to authenticated;
grant select, insert, update, delete on public.integration_sync_runs to service_role;

-- ===========================================================================
-- 6. integration_conflicts: a disagreement between OneLedger and an external
--    source, awaiting a human decision. Never auto-resolved.
-- ===========================================================================
create table public.integration_conflicts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  sync_run_id uuid references public.integration_sync_runs (id) on delete set null,
  connected_workbook_id uuid references public.connected_workbooks (id) on delete set null,
  ref_type text not null,
  ref_id text,
  field text,
  oneledger_value jsonb,
  external_value jsonb,
  status text not null default 'open' check (status in (
    'open', 'kept_oneledger', 'accepted_external', 'edited', 'ignored'
  )),
  resolved_by uuid references auth.users (id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.integration_conflicts is
  'A field-level disagreement between OneLedger and an external source detected during a sync. Append-only until resolved; resolution routes ledger writes through the existing audited import path.';

create index idx_integration_conflicts_workspace_status
  on public.integration_conflicts (workspace_id, status);
create index idx_integration_conflicts_run
  on public.integration_conflicts (sync_run_id);

alter table public.integration_conflicts enable row level security;

create policy integration_conflicts_select_member on public.integration_conflicts
  for select to authenticated
  using (public.has_space_capability(workspace_id, 'integration.view'));

revoke all on public.integration_conflicts from anon;
grant select on public.integration_conflicts to authenticated;
grant select, insert, update, delete on public.integration_conflicts to service_role;

-- ===========================================================================
-- 7. Wire destinations into the Phase 1 export pipeline.
--    null destination_id = the current "download" behaviour.
-- ===========================================================================
alter table public.export_jobs
  add column destination_id uuid references public.integration_destinations (id) on delete set null;
create index idx_export_jobs_destination on public.export_jobs (destination_id)
  where destination_id is not null;

alter table public.export_schedules
  add column destination_id uuid references public.integration_destinations (id) on delete set null;

-- last_sync_run_id FK is added now that integration_sync_runs exists.
alter table public.connected_workbooks
  add constraint connected_workbooks_last_sync_run_fk
  foreign key (last_sync_run_id) references public.integration_sync_runs (id)
  on delete set null;
