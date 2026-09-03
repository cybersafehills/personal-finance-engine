-- Integrations Phase 3, P3-PR3: the "Ready for Accountant" package -
-- a period-scoped, downloadable ZIP an accountant can be handed directly
-- (ledger CSV/XLSX + a reconciliation summary + a PDF cover).
--
-- Follows the same conventions as the rest of the Integrations model:
-- one new capability added forward-only to the closed catalog
-- (20261101000000 is the template), an RLS-SELECT-on-integration.view
-- table whose writes go through the service role only, and a private
-- Storage bucket on the "report-artifacts" model (public = false, no
-- storage.objects policies - every byte is served through a short-lived
-- signed URL after an independent capability check).

-- ===========================================================================
-- 1. Capability catalog: +1 (owner/admin only, never member). Forward-only
--    replace of the function body + the additive grant CHECK. The list
--    below is the union of the closed integration.* set, the Bills &
--    Expenses bill.* set (20261110000000, which merged first), and this
--    PR's integration.accountant_package - re-declaring the function must
--    never silently drop a capability a concurrently-merged phase added.
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
      'bill.upload', 'bill.review', 'bill.approve', 'bill.post',
      'bill.manage', 'bill.download_original', 'bill.audit.view',
      'bill.configure',
      'integration.accountant_package'
    )
    and case
      when p_kind = 'personal' then p_role = 'owner'
      when p_role = 'owner' then true
      when p_role = 'admin'
        then p_capability not in ('space.delete', 'space.transfer_ownership')
      when p_role = 'member'
        then p_capability in (
          'transaction.create', 'transaction.categorize', 'integration.view',
          'bill.upload', 'bill.review'
        )
      else false
    end,
    false
  );
$$;

comment on function public.space_role_has_capability is
  'Closed Spaces capability matrix. Unknown and null capabilities always fail closed. Owner: all 32 known capabilities. Admin: all except space.delete / space.transfer_ownership. Member: transaction.create / transaction.categorize / integration.view / bill.upload / bill.review. Viewer: none.';

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
    'bill.upload', 'bill.review', 'bill.approve', 'bill.post',
    'bill.manage', 'bill.download_original', 'bill.audit.view',
    'bill.configure',
    'integration.accountant_package'
  )) not valid;

alter table public.space_member_capability_grants
  validate constraint space_member_capability_grants_known_capability;

-- ===========================================================================
-- 2. accountant_packages: one build request + its lifecycle. Output is a
--    single ZIP in the private integration-accountant-packages bucket,
--    handed to the user only through a time-limited signed URL. Small
--    builds run inline in the createAccountantPackage action; large ones
--    are claimed by the build-accountant-packages cron (P3-PR4).
-- ===========================================================================
create table public.accountant_packages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  created_by uuid references auth.users (id),
  period_start date not null,
  period_end date not null,
  status text not null default 'queued' check (status in (
    'queued', 'building', 'ready', 'failed'
  )),
  -- what the ZIP contains, e.g. {'csv','xlsx','pdf'} - never any bytes.
  formats text[] not null default '{}'::text[],
  -- {workspace_id}/{package_id}/oneledger-accountant-package.zip
  storage_path text,
  -- redacted rollup only: row / section counts, the period label, the
  -- reconciliation-summary headline. NEVER raw financial text or ids.
  manifest jsonb not null default '{}'::jsonb,
  row_count integer,
  byte_size bigint,
  error jsonb,
  -- background claim/lease for the P3-PR4 cron
  claim_token uuid,
  claimed_at timestamptz,
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint accountant_packages_period_ordered check (period_end >= period_start)
);

comment on table public.accountant_packages is
  'One "Ready for Accountant" package build and its lifecycle. Output is a single ZIP in the private integration-accountant-packages bucket, handed to the user only through a short-lived signed URL. manifest is a redacted rollup - no raw financial text, no ids.';

create index idx_accountant_packages_workspace_status
  on public.accountant_packages (workspace_id, status);
create index idx_accountant_packages_workspace_requested
  on public.accountant_packages (workspace_id, requested_at desc);
create index idx_accountant_packages_pending
  on public.accountant_packages (status, requested_at)
  where status in ('queued', 'building');

create trigger set_accountant_packages_updated_at
  before update on public.accountant_packages
  for each row execute function public.set_updated_at();

alter table public.accountant_packages enable row level security;

create policy accountant_packages_select_member on public.accountant_packages
  for select to authenticated
  using (public.has_space_capability(workspace_id, 'integration.view'));

revoke all on public.accountant_packages from anon;
grant select on public.accountant_packages to authenticated;
grant select, insert, update, delete on public.accountant_packages to service_role;

-- ===========================================================================
-- 3. Private storage bucket. Same model as integration-exports /
--    integration-imports / the Phase K report-artifacts bucket:
--    public = false, no storage.objects RLS policies. Every read and write
--    is done by the service-role client (the createAccountantPackage
--    action + the build-accountant-packages cron), which resolves the
--    workspace explicitly and keys objects under
--      {workspace_id}/{package_id}/oneledger-accountant-package.zip
--    Downloads are a short-lived signed URL from
--    GET /api/integrations/accountant/[id] only.
-- ===========================================================================
insert into storage.buckets (id, name, public)
values (
  'integration-accountant-packages', 'integration-accountant-packages', false
)
on conflict (id) do nothing;
