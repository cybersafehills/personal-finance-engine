-- Connector model Stage B: deterministic legacy preflight + backfill.
-- Existing ingestion_connections remains the live ingestion path. Canonical
-- rows are compatibility mirrors only until Stage C explicitly dual-writes.

alter table public.connector_installations
  add column legacy_ingestion_connection_id uuid
    references public.ingestion_connections (id) on delete restrict;

create unique index connector_installations_legacy_connection_unique
  on public.connector_installations (legacy_ingestion_connection_id)
  where legacy_ingestion_connection_id is not null;

alter table public.device_credentials
  add column legacy_ingestion_connection_id uuid
    references public.ingestion_connections (id) on delete restrict;

create unique index device_credentials_legacy_connection_unique
  on public.device_credentials (legacy_ingestion_connection_id)
  where legacy_ingestion_connection_id is not null;

alter table public.ingestion_connections
  add column connector_installation_id uuid
    references public.connector_installations (id) on delete restrict,
  add column device_credential_id uuid
    references public.device_credentials (id) on delete restrict,
  add constraint ingestion_connections_canonical_mapping_complete check (
    (connector_installation_id is null) = (device_credential_id is null)
  );

create unique index ingestion_connections_connector_installation_unique
  on public.ingestion_connections (connector_installation_id)
  where connector_installation_id is not null;
create unique index ingestion_connections_device_credential_unique
  on public.ingestion_connections (device_credential_id)
  where device_credential_id is not null;

comment on column public.ingestion_connections.connector_installation_id is
  'Stage B reversible compatibility mapping to the canonical installation. Legacy auth/routing remains live until Stage C.';
comment on column public.ingestion_connections.device_credential_id is
  'Stage B reversible compatibility mapping to the canonical device credential. Legacy credential columns remain live until cutover.';

create or replace function public.connector_stage_b_preflight(
  p_ingestion_connection_id uuid default null
)
returns table (
  ingestion_connection_id uuid,
  issue_code text,
  detail text
)
language sql
security definer
set search_path = public
stable
as $$
  with candidates as (
    select
      ic.id,
      ic.workspace_id,
      ic.account_id,
      ic.credential_hash,
      ic.connector_installation_id,
      ic.device_credential_id,
      a.financial_source_id,
      fs.owner_user_id,
      fs.connector_installation_id as source_installation_id,
      count(*) filter (where ic.connector_installation_id is null)
        over (partition by a.financial_source_id) as unmapped_source_count
    from public.ingestion_connections ic
    left join public.accounts a on a.id = ic.account_id
    left join public.financial_sources fs on fs.id = a.financial_source_id
  ), issues as (
  select id, 'partial_mapping',
    'Legacy row has only one of connector_installation_id/device_credential_id.'
  from candidates
  where (connector_installation_id is null) <> (device_credential_id is null)

  union all
  select id, 'missing_financial_source',
    'The bound account has no financial_source_id; ownership cannot be inferred.'
  from candidates where financial_source_id is null

  union all
  select id, 'missing_source_owner',
    'The bound financial source has no owner.'
  from candidates where financial_source_id is not null and owner_user_id is null

  union all
  select id, 'source_already_attached',
    'The source is already attached to a different connector installation.'
  from candidates
  where connector_installation_id is null and source_installation_id is not null

  union all
  select id, 'shared_source_ambiguous',
    'More than one unmapped legacy connection points at this financial source.'
  from candidates
  where connector_installation_id is null
    and financial_source_id is not null
    and unmapped_source_count > 1

  union all
  select c.id, 'credential_hash_collision',
    'The legacy credential hash already belongs to an unrelated canonical credential.'
  from candidates c
  join public.device_credentials dc on dc.credential_hash = c.credential_hash
  where dc.legacy_ingestion_connection_id is distinct from c.id

  union all
  select c.id, 'mapped_installation_mismatch',
    'The mapped installation does not point back to this legacy connection/source.'
  from candidates c
  join public.connector_installations ci on ci.id = c.connector_installation_id
  where c.connector_installation_id is not null
    and (
      ci.legacy_ingestion_connection_id is distinct from c.id
      or c.source_installation_id is distinct from ci.id
    )

  union all
  select c.id, 'mapped_credential_mismatch',
    'The mapped credential does not point back to this legacy connection/installation/account.'
  from candidates c
  join public.device_credentials dc on dc.id = c.device_credential_id
  where c.device_credential_id is not null
    and (
      dc.legacy_ingestion_connection_id is distinct from c.id
      or dc.connector_installation_id is distinct from c.connector_installation_id
      or dc.account_id is distinct from c.account_id
      or dc.credential_hash is distinct from c.credential_hash
    )
  )
  select * from issues
  where p_ingestion_connection_id is null
     or id = p_ingestion_connection_id;
$$;

comment on function public.connector_stage_b_preflight(uuid) is
  'Service-role-only deterministic Stage B audit. Any returned row blocks backfill; no owner/source guess is permitted.';
revoke all on function public.connector_stage_b_preflight(uuid) from public;
grant execute on function public.connector_stage_b_preflight(uuid) to service_role;

create or replace function public.backfill_legacy_ingestion_connection(
  p_ingestion_connection_id uuid
)
returns table (connector_installation_id uuid, device_credential_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_connection public.ingestion_connections%rowtype;
  v_source_id uuid;
  v_owner_id uuid;
  v_installation_id uuid;
  v_credential_id uuid;
  v_issue text;
  v_connector_key text;
  v_installation_status text;
begin
  -- Serialize Stage B work without blocking unrelated ingestion writes.
  perform pg_advisory_xact_lock(hashtext('oneledger.connector_stage_b'));

  select * into v_connection
  from public.ingestion_connections
  where id = p_ingestion_connection_id
  for update;

  if not found then
    raise exception 'Unknown ingestion connection: %', p_ingestion_connection_id;
  end if;

  select string_agg(p.issue_code || ': ' || p.detail, '; ' order by p.issue_code)
    into v_issue
  from public.connector_stage_b_preflight(p_ingestion_connection_id) p;

  if v_issue is not null then
    raise exception 'Connector Stage B preflight failed for %: %',
      p_ingestion_connection_id, v_issue;
  end if;

  if v_connection.connector_installation_id is not null then
    return query select
      v_connection.connector_installation_id,
      v_connection.device_credential_id;
    return;
  end if;

  select a.financial_source_id, fs.owner_user_id
    into v_source_id, v_owner_id
  from public.accounts a
  join public.financial_sources fs on fs.id = a.financial_source_id
  where a.id = v_connection.account_id;

  v_connector_key := case v_connection.provider
    when 'mtn_momo' then 'mtn_momo_sms_v1'
    when 'airtel_money' then 'airtel_money_sms_v1'
    when 'bank' then 'bank_legacy_push_v1'
    else 'generic_legacy_push_v1'
  end;

  v_installation_status := case v_connection.status
    when 'active' then 'healthy'
    when 'paused' then 'paused'
    else 'revoked'
  end;

  insert into public.connector_installations (
    owner_user_id, home_workspace_id, connector_key,
    external_installation_id, display_name, status, auth_mode,
    last_success_at, revoked_at, created_by, created_at,
    legacy_ingestion_connection_id
  ) values (
    v_owner_id, v_connection.workspace_id, v_connector_key,
    'legacy:' || v_connection.id::text, v_connection.label,
    v_installation_status, 'device_secret', v_connection.last_used_at,
    case when v_connection.status = 'revoked' then v_connection.revoked_at else null end,
    v_connection.created_by, v_connection.created_at, v_connection.id
  ) returning id into v_installation_id;

  update public.financial_sources
  set connector_installation_id = v_installation_id,
      provider_key = coalesce(provider_key, v_connection.provider)
  where id = v_source_id;

  insert into public.device_credentials (
    connector_installation_id, account_id, label,
    credential_hash, credential_prefix, status,
    last_used_at, created_by, created_at, paused_at, revoked_at,
    legacy_ingestion_connection_id
  ) values (
    v_installation_id, v_connection.account_id, v_connection.label,
    v_connection.credential_hash, v_connection.credential_prefix,
    v_connection.status, v_connection.last_used_at,
    v_connection.created_by, v_connection.created_at,
    v_connection.paused_at, v_connection.revoked_at, v_connection.id
  ) returning id into v_credential_id;

  update public.ingestion_connections
  set connector_installation_id = v_installation_id,
      device_credential_id = v_credential_id
  where id = v_connection.id;

  return query select v_installation_id, v_credential_id;
end;
$$;

comment on function public.backfill_legacy_ingestion_connection(uuid) is
  'Service-role-only, idempotent Stage B backfill for exactly one legacy row. Runs preflight and never guesses missing/ambiguous source ownership.';
revoke all on function public.backfill_legacy_ingestion_connection(uuid) from public;
grant execute on function public.backfill_legacy_ingestion_connection(uuid) to service_role;

-- Deployment-time all-or-nothing preflight and backfill. On a fresh reset
-- there may be zero connections; on production every existing row is checked.
do $$
declare
  v_issues text;
  v_id uuid;
begin
  select string_agg(
    p.ingestion_connection_id::text || ' [' || p.issue_code || '] ' || p.detail,
    E'\n' order by p.ingestion_connection_id, p.issue_code
  ) into v_issues
  from public.connector_stage_b_preflight(null) p;

  if v_issues is not null then
    raise exception 'Connector Stage B preflight failed:%', E'\n' || v_issues;
  end if;

  for v_id in
    select id from public.ingestion_connections
    where connector_installation_id is null
    order by created_at, id
  loop
    perform public.backfill_legacy_ingestion_connection(v_id);
  end loop;
end $$;
