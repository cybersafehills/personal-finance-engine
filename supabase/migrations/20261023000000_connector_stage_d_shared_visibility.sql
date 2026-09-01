-- Connector Stage D: shared-workspace-safe canonical settings visibility.
--
-- Legacy ingestion connections are visible to every active member of their
-- workspace. Canonical installations initially exposed owner metadata only,
-- which correctly kept the read cutover fail-closed but prevented shared
-- workspaces from adopting the canonical projection. This migration restores
-- that metadata parity without broadening source/account visibility or
-- exposing either credential hashes or encrypted connector state.

drop policy connector_installations_select_owner
  on public.connector_installations;

create policy connector_installations_select_workspace_member
  on public.connector_installations for select to authenticated
  using (
    owner_user_id = auth.uid()
    or public.is_workspace_member(home_workspace_id)
  );

comment on policy connector_installations_select_workspace_member
  on public.connector_installations is
  'Owners and active home-workspace members may read non-secret installation metadata. Authenticated column grants continue to exclude sync_cursor_encrypted.';

drop policy device_credentials_select_owner
  on public.device_credentials;

create policy device_credentials_select_visible
  on public.device_credentials for select to authenticated
  using (
    exists (
      select 1
      from public.connector_installations ci
      where ci.id = connector_installation_id
        and (
          ci.owner_user_id = auth.uid()
          or (
            public.is_workspace_member(ci.home_workspace_id)
            and device_credentials.account_id is not null
            and exists (
              select 1
              from public.accounts a
              where a.id = device_credentials.account_id
                and public.can_view_source_in_space(
                  a.financial_source_id,
                  a.workspace_id
                )
            )
          )
        )
    )
  );

comment on policy device_credentials_select_visible
  on public.device_credentials is
  'Owners may read all non-secret credential metadata. Home-workspace members may read account-scoped credentials only when the account/source is visible to them; installation-wide credentials remain owner-only. credential_hash remains excluded from authenticated grants.';

-- SECURITY DEFINER bypasses table RLS, so this readiness gate must restate
-- every visibility predicate used by the canonical UI. A legacy row is exact
-- only when its installation, source, account, and credential would all be
-- readable by the caller under the policies above.
create or replace function public.get_connector_canonical_read_cutover_status()
returns table (
  visible_legacy_count bigint,
  exact_canonical_count bigint,
  blocking_count bigint,
  ready boolean
)
language sql
security definer
set search_path = public
stable
as $$
  with visible_legacy as (
    select ic.*
    from public.ingestion_connections ic
    where auth.uid() is not null
      and public.is_workspace_member(ic.workspace_id)
  ), exact_mappings as (
    select vl.id
    from visible_legacy vl
    join public.connector_installations ci
      on ci.id = vl.connector_installation_id
      and ci.legacy_ingestion_connection_id = vl.id
      and (
        ci.owner_user_id = auth.uid()
        or public.is_workspace_member(ci.home_workspace_id)
      )
    join public.device_credentials dc
      on dc.id = vl.device_credential_id
      and dc.connector_installation_id = ci.id
      and dc.legacy_ingestion_connection_id = vl.id
      and dc.account_id = vl.account_id
    join public.accounts a
      on a.id = vl.account_id
      and a.workspace_id = vl.workspace_id
    join public.financial_sources fs
      on fs.id = a.financial_source_id
      and fs.connector_installation_id = ci.id
    where public.is_financial_source_visible(fs.id)
      and public.can_view_source_in_space(fs.id, a.workspace_id)
  ), counts as (
    select
      (select count(*) from visible_legacy) as visible_count,
      (select count(*) from exact_mappings) as exact_count
  )
  select
    visible_count,
    exact_count,
    visible_count - exact_count,
    visible_count = exact_count
  from counts;
$$;

comment on function public.get_connector_canonical_read_cutover_status() is
  'Fail-closed gate for the canonical Connections UI. Ready only when every legacy row visible to the caller maps exactly to canonical installation, credential, source, and account rows that the caller can read.';
