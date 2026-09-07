-- Financial Documents Engine - the `statement.generate` capability.
--
-- Adds one capability to the closed Spaces matrix so an owner/admin can
-- grant a specific household/organization member (or even a viewer) the
-- ability to generate statements beyond what their role gives by default,
-- via the existing grant_space_capability() RPC. The role defaults:
--   * personal owner - yes (the p_kind='personal' branch)
--   * household/org owner + admin - yes
--   * household/org member - yes (added to the member list below)
--   * household/org viewer - no, unless explicitly granted
--
-- Forward-only `create or replace`: the capability list is the UNION of
-- every prior phase's set (the Phase 3 lesson - a re-declare that drops a
-- concurrently-merged phase's capabilities breaks that phase), plus
-- 'statement.generate'. The grants CHECK constraint is widened to match.

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
      'integration.accountant_package',
      'integration.ledger_manage', 'integration.ledger_sync',
      'integration.developer_manage',
      'statement.generate'
    )
    and case
      when p_kind = 'personal' then p_role = 'owner'
      when p_role = 'owner' then true
      when p_role = 'admin'
        then p_capability not in ('space.delete', 'space.transfer_ownership')
      when p_role = 'member'
        then p_capability in (
          'transaction.create', 'transaction.categorize', 'integration.view',
          'bill.upload', 'bill.review', 'statement.generate'
        )
      else false
    end,
    false
  );
$$;

comment on function public.space_role_has_capability is
  'Closed Spaces capability matrix. Unknown and null capabilities always fail closed. Owner: all 36 known capabilities. Admin: all except space.delete / space.transfer_ownership. Member: transaction.create / transaction.categorize / integration.view / bill.upload / bill.review / statement.generate. Viewer: none.';

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
    'integration.accountant_package',
    'integration.ledger_manage', 'integration.ledger_sync',
    'integration.developer_manage',
    'statement.generate'
  )) not valid;

alter table public.space_member_capability_grants
  validate constraint space_member_capability_grants_known_capability;

-- grant_space_capability carries its own catalog check. Re-declare with the
-- FULL current set (the developer-platform capabilities from
-- 20261121000000 were added to the matrix + CHECK there but not to this
-- function's list - fixed here) plus 'statement.generate'. Body otherwise
-- byte-identical to 20261110000000_bills_phase_1_intake_and_lifecycle.sql.
create or replace function public.grant_space_capability(
  p_workspace_id uuid,
  p_user_id uuid,
  p_capability text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_space_capability(p_workspace_id, 'members.manage') then
    raise exception 'You do not have permission to manage members of this Space.';
  end if;

  if p_capability not in (
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
    'integration.accountant_package',
    'integration.ledger_manage', 'integration.ledger_sync',
    'integration.developer_manage',
    'statement.generate'
  ) then
    raise exception 'Unknown capability: %', p_capability;
  end if;

  if not exists (
    select 1 from public.workspace_memberships
    where workspace_id = p_workspace_id
      and user_id = p_user_id
      and status = 'active'
  ) then
    raise exception 'That person is not an active member of this Space.';
  end if;

  insert into public.space_member_capability_grants
    (workspace_id, user_id, capability, granted_by)
  values (p_workspace_id, p_user_id, p_capability, auth.uid())
  on conflict (workspace_id, user_id, capability) do nothing;

  perform public.record_space_audit_event(
    p_workspace_id, 'capability.granted', 'user', p_user_id,
    null, jsonb_build_object('capability', p_capability));
end;
$$;

revoke all on function public.grant_space_capability(uuid, uuid, text) from public;
grant execute on function public.grant_space_capability(uuid, uuid, text) to authenticated;
