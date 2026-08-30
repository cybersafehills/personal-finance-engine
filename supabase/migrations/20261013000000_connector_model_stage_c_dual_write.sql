-- Connector model Stage C: atomic dual-write enrollment, compatibility
-- synchronization, and a service-only canonical shadow resolver. The legacy
-- ingestion_connections credential lookup remains authoritative for now.

create or replace function public.sync_legacy_connection_to_canonical()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.connector_installation_id is null or new.device_credential_id is null then
    return new;
  end if;

  update public.connector_installations
  set display_name = new.label,
      status = case new.status
        when 'active' then 'healthy'
        when 'paused' then 'paused'
        else 'revoked'
      end,
      last_success_at = new.last_used_at,
      revoked_at = case when new.status = 'revoked' then new.revoked_at else null end
  where id = new.connector_installation_id
    and legacy_ingestion_connection_id = new.id;

  update public.device_credentials
  set label = new.label,
      credential_hash = new.credential_hash,
      credential_prefix = new.credential_prefix,
      status = new.status,
      last_used_at = new.last_used_at,
      paused_at = new.paused_at,
      revoked_at = new.revoked_at
  where id = new.device_credential_id
    and connector_installation_id = new.connector_installation_id
    and legacy_ingestion_connection_id = new.id;

  return new;
end;
$$;

comment on function public.sync_legacy_connection_to_canonical is
  'Internal Stage C compatibility trigger. Mirrors legacy label, credential, lifecycle, and health fields while legacy remains authoritative.';
revoke all on function public.sync_legacy_connection_to_canonical() from public;

create trigger sync_legacy_connection_to_canonical
  after update of label, credential_hash, credential_prefix, status,
    last_used_at, paused_at, revoked_at, connector_installation_id,
    device_credential_id
  on public.ingestion_connections
  for each row execute function public.sync_legacy_connection_to_canonical();

create or replace function public.create_ingestion_connection_dual_write(
  p_workspace_id uuid,
  p_account_id uuid,
  p_label text,
  p_provider text,
  p_credential_hash text,
  p_credential_prefix text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_connection_id uuid;
  v_source_owner uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if not public.is_workspace_member(p_workspace_id, 'owner') then
    raise exception 'Only a workspace owner can create a connection.';
  end if;

  select fs.owner_user_id into v_source_owner
  from public.accounts a
  join public.financial_sources fs on fs.id = a.financial_source_id
  where a.id = p_account_id
    and a.workspace_id = p_workspace_id
    and a.is_active
    and a.archived_at is null;

  if v_source_owner is null then
    raise exception 'The selected account has no active financial source.';
  end if;

  if v_source_owner <> auth.uid() then
    raise exception 'You can only connect a financial source you own.';
  end if;

  insert into public.ingestion_connections (
    workspace_id, account_id, label, provider,
    credential_hash, credential_prefix, created_by
  ) values (
    p_workspace_id, p_account_id, trim(p_label), p_provider,
    p_credential_hash, p_credential_prefix, auth.uid()
  ) returning id into v_connection_id;

  perform public.backfill_legacy_ingestion_connection(v_connection_id);
  return v_connection_id;
end;
$$;

comment on function public.create_ingestion_connection_dual_write(uuid, uuid, text, text, text, text) is
  'Authenticated Stage C enrollment: atomically creates the legacy connection and its canonical installation/device mapping. Plaintext credentials are never accepted.';
revoke all on function public.create_ingestion_connection_dual_write(uuid, uuid, text, text, text, text) from public;
grant execute on function public.create_ingestion_connection_dual_write(uuid, uuid, text, text, text, text) to authenticated;

-- New rows must pass through the atomic RPC. Authenticated lifecycle updates
-- remain available under the existing owner policy and are mirrored by the
-- trigger above.
drop policy ingestion_connections_write_owner on public.ingestion_connections;
revoke insert on public.ingestion_connections from authenticated;

create or replace function public.resolve_canonical_ingestion_shadow(
  p_ingestion_connection_id uuid
)
returns table (
  matches_legacy boolean,
  mismatch_code text,
  connector_installation_id uuid,
  device_credential_id uuid,
  workspace_id uuid,
  account_id uuid,
  financial_source_id uuid
)
language sql
security definer
set search_path = public
stable
as $$
  with resolved as (
    select
      ic.id as legacy_id,
      ic.workspace_id as legacy_workspace_id,
      ic.account_id as legacy_account_id,
      ic.status as legacy_status,
      ic.credential_hash as legacy_credential_hash,
      ic.connector_installation_id,
      ic.device_credential_id,
      ci.id as canonical_installation_id,
      ci.home_workspace_id as canonical_workspace_id,
      ci.status as installation_status,
      ci.legacy_ingestion_connection_id as installation_legacy_id,
      dc.id as canonical_credential_id,
      dc.connector_installation_id as credential_installation_id,
      dc.account_id as canonical_account_id,
      dc.status as credential_status,
      dc.credential_hash as canonical_credential_hash,
      dc.legacy_ingestion_connection_id as credential_legacy_id,
      a.financial_source_id,
      fs.connector_installation_id as source_installation_id
    from public.ingestion_connections ic
    left join public.connector_installations ci
      on ci.id = ic.connector_installation_id
    left join public.device_credentials dc
      on dc.id = ic.device_credential_id
    left join public.accounts a on a.id = ic.account_id
    left join public.financial_sources fs on fs.id = a.financial_source_id
    where ic.id = p_ingestion_connection_id
  ), checked as (
    select *, case
      when connector_installation_id is null or device_credential_id is null
        then 'canonical_mapping_missing'
      when canonical_installation_id is null or canonical_credential_id is null
        then 'canonical_row_missing'
      when installation_legacy_id is distinct from legacy_id
        or credential_legacy_id is distinct from legacy_id
        then 'legacy_backlink_mismatch'
      when canonical_workspace_id is distinct from legacy_workspace_id
        then 'workspace_mismatch'
      when canonical_account_id is distinct from legacy_account_id
        then 'account_mismatch'
      when credential_installation_id is distinct from connector_installation_id
        or source_installation_id is distinct from connector_installation_id
        then 'installation_scope_mismatch'
      when canonical_credential_hash is distinct from legacy_credential_hash
        then 'credential_mismatch'
      when credential_status is distinct from legacy_status
        then 'credential_status_mismatch'
      when installation_status is distinct from case legacy_status
        when 'active' then 'healthy'
        when 'paused' then 'paused'
        else 'revoked'
      end then 'installation_status_mismatch'
      else null
    end as mismatch
    from resolved
  )
  select
    mismatch is null,
    mismatch,
    connector_installation_id,
    device_credential_id,
    canonical_workspace_id,
    canonical_account_id,
    financial_source_id
  from checked;
$$;

comment on function public.resolve_canonical_ingestion_shadow(uuid) is
  'Service-role-only Stage C shadow route. Returns canonical provenance only with an explicit mismatch code; ingestion rejects any non-match.';
revoke all on function public.resolve_canonical_ingestion_shadow(uuid) from public;
grant execute on function public.resolve_canonical_ingestion_shadow(uuid) to service_role;
