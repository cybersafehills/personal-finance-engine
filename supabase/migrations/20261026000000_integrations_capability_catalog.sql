-- Integrations Phase 1, PR 0: extend the closed Spaces capability catalog
-- with the integration.* capabilities the Integrations area enforces.
--
-- Forward-only: 20261010000000_closed_capability_catalog.sql is already
-- deployed and must not be edited. This migration replaces the function
-- body and adds a second, additive CHECK on
-- space_member_capability_grants so the two lists stay in lockstep while
-- the original constraint keeps protecting historical rows.
--
-- New capabilities (8):
--   integration.view              - see the Integrations area and its dashboards
--   integration.import            - upload files and stage import records
--   integration.import_approve    - commit or roll back an import batch
--   integration.export            - generate an export (CSV / XLSX)
--   integration.configure         - manage import/export templates and schedules
--   integration.connection_manage - create / pause / rotate / revoke connections
--   integration.sync_manage       - manage sync settings and scheduled deliveries
--   integration.logs_view         - see raw-ish integration activity / health logs
--
-- Role mapping (unchanged philosophy - unknown/null still fails closed):
--   personal owner : all
--   owner          : all
--   admin          : all except space.delete / space.transfer_ownership
--   member         : transaction.create, transaction.categorize, integration.view
--   viewer         : none

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
      'integration.logs_view'
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
  'Closed Spaces capability matrix. Unknown and null capabilities always fail closed. Owner: all 20 known capabilities. Admin: all except space.delete / space.transfer_ownership. Member: transaction.create / transaction.categorize / integration.view. Viewer: none.';

-- Additive companion to space_member_capability_grants_known_capability
-- (from 20261010000000). The original constraint stays; this one widens
-- the accepted set to include integration.* for new grant rows.
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
    'integration.logs_view'
  )) not valid;

alter table public.space_member_capability_grants
  validate constraint space_member_capability_grants_known_capability;
