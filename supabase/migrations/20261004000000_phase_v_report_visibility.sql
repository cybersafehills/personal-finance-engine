-- Phase V (PR4b): per-member source visibility for scheduled reports.
--
-- The daily-report generator runs as service_role with no auth.uid(), so
-- it cannot call can_view_source_in_space() (which keys off auth.uid()).
-- This helper takes the user explicitly. It returns the financial sources
-- a user may see in a given Space: the ones they own, plus the ones
-- shared into that Space via an active source_space_link. The web
-- generator applies this filter only for household workspaces (in a
-- personal / organization Space a member already sees everything).

create or replace function public.visible_source_ids_for_user(
  p_workspace_id uuid,
  p_user_id uuid
)
returns setof uuid
language sql
security definer
set search_path = public
stable
as $$
  select fs.id
  from public.financial_sources fs
  where fs.owner_user_id = p_user_id
     or exists (
       select 1
       from public.source_space_links l
       where l.financial_source_id = fs.id
         and l.workspace_id = p_workspace_id
         and l.status = 'active'
         and l.visibility_mode in ('share_transactions', 'share_account')
     );
$$;

comment on function public.visible_source_ids_for_user is
  'Service-role only: the financial_sources p_user_id may see in p_workspace_id (owned, or shared in via an active source_space_link). The auth.uid()-free counterpart of can_view_source_in_space, for the scheduled-report generator.';

revoke all on function public.visible_source_ids_for_user(uuid, uuid) from public;
grant execute on function public.visible_source_ids_for_user(uuid, uuid) to service_role;
