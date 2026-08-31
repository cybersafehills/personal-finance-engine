-- Connector model Stage D: default-off canonical credential authentication.
-- The Edge Function can switch its credential lookup to this resolver after
-- the production shadow gate passes. The returned compatibility connection
-- keeps all later writes and the existing shadow comparison unchanged, so
-- rollback is an environment toggle rather than a data migration.

create or replace function public.resolve_canonical_ingestion_credential(
  p_credential_hash text
)
returns table (
  id uuid,
  workspace_id uuid,
  account_id uuid,
  status text,
  connector_installation_id uuid,
  device_credential_id uuid
)
language sql
security definer
set search_path = public
stable
as $$
  select
    dc.legacy_ingestion_connection_id,
    ci.home_workspace_id,
    dc.account_id,
    dc.status,
    dc.connector_installation_id,
    dc.id
  from public.device_credentials dc
  join public.connector_installations ci
    on ci.id = dc.connector_installation_id
  where dc.credential_hash = p_credential_hash
    and dc.status = 'active'
    and (dc.expires_at is null or dc.expires_at > statement_timestamp())
    and ci.status not in ('paused', 'revoked')
    -- Stage D continues compatibility writes. A canonical credential without
    -- a legacy mapping cannot safely enter the old downstream write path.
    and dc.legacy_ingestion_connection_id is not null;
$$;

comment on function public.resolve_canonical_ingestion_credential(text) is
  'Service-only Stage D credential lookup. Authenticates active, unexpired canonical credentials while returning the mapped legacy ID required during reversible cutover.';
revoke all on function public.resolve_canonical_ingestion_credential(text) from public;
grant execute on function public.resolve_canonical_ingestion_credential(text) to service_role;
