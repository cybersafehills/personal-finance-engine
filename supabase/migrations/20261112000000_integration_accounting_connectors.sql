-- Integrations Phase 3, P3-PR5: the accounting-connector data model.
--
-- A parallel to connected_workbooks (20261101000000) for accounting
-- systems - QuickBooks / Xero / Zoho Books / Odoo. Export-direction only
-- for now (push OneLedger ledger data to the external books); an
-- import direction is explicitly out of scope for Phase 3. Every provider
-- ships DARK: its OAuth adapter throws provider_not_configured until its
-- *_CLIENT_ID / *_SECRET env is set, and even configured, pushEntries is
-- deliberately unimplemented - the sync run records a `partial` outcome,
-- never a fake success. Same conventions as the rest of the Integrations
-- model: RLS SELECT on integration.view, writes service-role only,
-- integration_events as the activity surface.

-- ===========================================================================
-- 1. Capability catalog: +2 (owner/admin only, never member). Forward-only
--    replace of the function body + the additive grant CHECK.
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
      'integration.conflict_resolve',
      'integration.accountant_package',
      'integration.ledger_manage', 'integration.ledger_sync'
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
  'Closed Spaces capability matrix. Unknown and null capabilities always fail closed. Owner: all 26 known capabilities. Admin: all except space.delete / space.transfer_ownership. Member: transaction.create / transaction.categorize / integration.view. Viewer: none.';

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
    'integration.conflict_resolve',
    'integration.accountant_package',
    'integration.ledger_manage', 'integration.ledger_sync'
  )) not valid;

alter table public.space_member_capability_grants
  validate constraint space_member_capability_grants_known_capability;

-- ===========================================================================
-- 2. Widen integration_destinations: a new kind ('accounting') and four
--    new provider keys. Forward-only drop + re-add of the inline CHECKs
--    (auto-named <table>_<column>_check).
-- ===========================================================================
alter table public.integration_destinations
  drop constraint if exists integration_destinations_kind_check;
alter table public.integration_destinations
  add constraint integration_destinations_kind_check
  check (kind in (
    'download', 'webhook', 'cloud_storage', 'connected_workbook', 'accounting'
  )) not valid;
alter table public.integration_destinations
  validate constraint integration_destinations_kind_check;

alter table public.integration_destinations
  drop constraint if exists integration_destinations_provider_check;
alter table public.integration_destinations
  add constraint integration_destinations_provider_check
  check (provider in (
    'google_drive', 'onedrive', 'dropbox', 'google_sheets', 'excel_365',
    'custom', 'quickbooks', 'xero', 'zoho_books', 'odoo'
  )) not valid;
alter table public.integration_destinations
  validate constraint integration_destinations_provider_check;

-- ===========================================================================
-- 3. connected_ledgers: a persistent link between OneLedger and an
--    external accounting system, keyed to an 'accounting' destination.
-- ===========================================================================
create table public.connected_ledgers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  destination_id uuid not null
    references public.integration_destinations (id) on delete cascade,
  -- opaque provider handle (a QuickBooks realmId, an Odoo db name, ...).
  external_ref text,
  -- { "category:Meals": "77", "account:<uuid>": "1200", ... } - OneLedger
  -- category / account keys mapped to external account ids. No secrets.
  account_map jsonb not null default '{}'::jsonb,
  -- export only for Phase 3 (push OneLedger -> external books).
  direction text not null default 'export' check (direction in ('export')),
  status text not null default 'active' check (status in (
    'active', 'paused', 'needs_auth', 'error', 'disconnected'
  )),
  last_sync_run_id uuid,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.connected_ledgers is
  'A persistent link between OneLedger and an external accounting system (QuickBooks / Xero / Zoho Books / Odoo). Export-direction only; account_map maps OneLedger category/account keys to external account ids. Provider adapters ship dark - a sync run against an unconfigured or unimplemented provider records a partial outcome, never a fake success.';

create index idx_connected_ledgers_workspace
  on public.connected_ledgers (workspace_id, status);
create index idx_connected_ledgers_destination
  on public.connected_ledgers (destination_id);

create trigger set_connected_ledgers_updated_at
  before update on public.connected_ledgers
  for each row execute function public.set_updated_at();

alter table public.connected_ledgers enable row level security;

create policy connected_ledgers_select_member on public.connected_ledgers
  for select to authenticated
  using (public.has_space_capability(workspace_id, 'integration.view'));

revoke all on public.connected_ledgers from anon;
grant select on public.connected_ledgers to authenticated;
grant select, insert, update, delete on public.connected_ledgers to service_role;

-- ===========================================================================
-- 4. integration_sync_runs gains a connected_ledger_id, mirroring the
--    existing connected_workbook_id.
-- ===========================================================================
alter table public.integration_sync_runs
  add column connected_ledger_id uuid
    references public.connected_ledgers (id) on delete set null;

create index idx_integration_sync_runs_ledger
  on public.integration_sync_runs (connected_ledger_id, created_at desc);
