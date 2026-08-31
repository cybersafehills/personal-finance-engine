-- Connector model Stage C stabilization: durable, aggregate evidence that
-- canonical shadow routing is being exercised. This table contains no
-- payload, credential, or customer-message data and is service-role-only.

create table public.connector_shadow_health (
  ingestion_connection_id uuid primary key
    references public.ingestion_connections(id) on delete cascade,
  connector_installation_id uuid
    references public.connector_installations(id) on delete set null,
  observation_count bigint not null default 0,
  match_count bigint not null default 0,
  mismatch_count bigint not null default 0,
  resolver_error_count bigint not null default 0,
  first_observed_at timestamptz not null default now(),
  last_observed_at timestamptz not null default now(),
  last_match_at timestamptz,
  last_mismatch_at timestamptz,
  last_mismatch_code text,
  updated_at timestamptz not null default now(),
  constraint connector_shadow_health_counts_nonnegative check (
    observation_count >= 0
    and match_count >= 0
    and mismatch_count >= 0
    and resolver_error_count >= 0
  ),
  constraint connector_shadow_health_counts_balance check (
    observation_count = match_count + mismatch_count + resolver_error_count
  ),
  constraint connector_shadow_health_code_format check (
    last_mismatch_code is null
    or last_mismatch_code ~ '^[a-z0-9_]{1,64}$'
  )
);

comment on table public.connector_shadow_health is
  'Service-only Stage C aggregate shadow-routing observations. Contains counters and redacted reason codes only; never payloads or credentials.';

create index connector_shadow_health_last_observed_idx
  on public.connector_shadow_health (last_observed_at desc);

alter table public.connector_shadow_health enable row level security;
revoke all on table public.connector_shadow_health from public, anon, authenticated;
grant select, insert, update on table public.connector_shadow_health to service_role;

create or replace function public.record_connector_shadow_observation(
  p_ingestion_connection_id uuid,
  p_outcome text,
  p_mismatch_code text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_connector_installation_id uuid;
  v_observed_at timestamptz := clock_timestamp();
begin
  if p_outcome not in ('match', 'mismatch', 'resolver_error') then
    raise exception 'Invalid connector shadow outcome.';
  end if;

  if p_outcome = 'match' and p_mismatch_code is not null then
    raise exception 'A matching shadow observation cannot have a mismatch code.';
  end if;

  if p_outcome <> 'match' and p_mismatch_code is null then
    raise exception 'A failed shadow observation requires a mismatch code.';
  end if;

  if p_mismatch_code is not null
    and p_mismatch_code !~ '^[a-z0-9_]{1,64}$' then
    raise exception 'Invalid connector shadow mismatch code.';
  end if;

  select ic.connector_installation_id
  into v_connector_installation_id
  from public.ingestion_connections ic
  where ic.id = p_ingestion_connection_id;

  if not found then
    raise exception 'Ingestion connection not found.';
  end if;

  insert into public.connector_shadow_health (
    ingestion_connection_id,
    connector_installation_id,
    observation_count,
    match_count,
    mismatch_count,
    resolver_error_count,
    first_observed_at,
    last_observed_at,
    last_match_at,
    last_mismatch_at,
    last_mismatch_code,
    updated_at
  ) values (
    p_ingestion_connection_id,
    v_connector_installation_id,
    1,
    case when p_outcome = 'match' then 1 else 0 end,
    case when p_outcome = 'mismatch' then 1 else 0 end,
    case when p_outcome = 'resolver_error' then 1 else 0 end,
    v_observed_at,
    v_observed_at,
    case when p_outcome = 'match' then v_observed_at else null end,
    case when p_outcome <> 'match' then v_observed_at else null end,
    p_mismatch_code,
    v_observed_at
  )
  on conflict (ingestion_connection_id) do update
  set connector_installation_id = excluded.connector_installation_id,
      observation_count = connector_shadow_health.observation_count + 1,
      match_count = connector_shadow_health.match_count
        + case when p_outcome = 'match' then 1 else 0 end,
      mismatch_count = connector_shadow_health.mismatch_count
        + case when p_outcome = 'mismatch' then 1 else 0 end,
      resolver_error_count = connector_shadow_health.resolver_error_count
        + case when p_outcome = 'resolver_error' then 1 else 0 end,
      last_observed_at = v_observed_at,
      last_match_at = case
        when p_outcome = 'match' then v_observed_at
        else connector_shadow_health.last_match_at
      end,
      last_mismatch_at = case
        when p_outcome <> 'match' then v_observed_at
        else connector_shadow_health.last_mismatch_at
      end,
      last_mismatch_code = case
        when p_outcome <> 'match' then p_mismatch_code
        else connector_shadow_health.last_mismatch_code
      end,
      updated_at = v_observed_at;
end;
$$;

comment on function public.record_connector_shadow_observation(uuid, text, text) is
  'Service-role-only Stage C counter update for match, mismatch, or resolver_error shadow outcomes. The installation ID is derived server-side.';
revoke all on function public.record_connector_shadow_observation(uuid, text, text) from public;
grant execute on function public.record_connector_shadow_observation(uuid, text, text) to service_role;
