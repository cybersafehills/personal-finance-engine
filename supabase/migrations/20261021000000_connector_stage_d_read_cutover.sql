-- Connector Stage D: fail-closed canonical settings read cutover.
--
-- The environment flag only requests the canonical UI. This owner-visible
-- readiness function proves that every legacy connection visible to the
-- current user has an exact, readable canonical installation + credential
-- mapping. Shared-workspace members therefore remain on the legacy projection
-- until canonical visibility semantics can represent their rows without loss.

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
      and ci.owner_user_id = auth.uid()
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
  'Owner-visible fail-closed gate for the canonical Connections UI. Ready only when every legacy row visible to the caller has an exact canonical route that the caller can read.';
revoke all on function public.get_connector_canonical_read_cutover_status()
  from public;
grant execute on function public.get_connector_canonical_read_cutover_status()
  to authenticated;

-- Canonical UI pairing entry point. Resolve the compatibility row inside the
-- database so the browser never needs to read a legacy ID after read cutover;
-- the existing pairing function remains the single validation/mutation path.
create or replace function public.pair_mtn_momo_adapter_canary_by_installation(
  p_connector_installation_id uuid,
  p_source_ref_hash text,
  p_account_ref_hash text,
  p_masked_identifier text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_connection_id uuid;
begin
  perform public.require_progressive_mfa();

  select ci.legacy_ingestion_connection_id
  into v_connection_id
  from public.connector_installations ci
  where ci.id = p_connector_installation_id
    and ci.owner_user_id = auth.uid();

  if v_connection_id is null then
    raise exception 'adapter_canary_route_unavailable' using errcode = '22023';
  end if;

  return public.pair_mtn_momo_adapter_canary(
    v_connection_id,
    p_source_ref_hash,
    p_account_ref_hash,
    p_masked_identifier
  );
end;
$$;

comment on function public.pair_mtn_momo_adapter_canary_by_installation(uuid, text, text, text) is
  'Canonical-UI MTN canary pairing entry point. Resolves the owner-bound legacy compatibility row and delegates all validation to the existing pairing workflow.';
revoke all on function public.pair_mtn_momo_adapter_canary_by_installation(uuid, text, text, text)
  from public;
grant execute on function public.pair_mtn_momo_adapter_canary_by_installation(uuid, text, text, text)
  to authenticated;
