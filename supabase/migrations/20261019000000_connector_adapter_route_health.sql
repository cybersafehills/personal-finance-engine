-- Durable, redacted rollout evidence for provider-adapter event routing.
-- The table contains aggregate counters only: never payloads, raw provider
-- references, account identifiers, or credential material.

create table public.connector_adapter_route_health (
  connector_installation_id uuid primary key
    references public.connector_installations(id) on delete cascade,
  connector_key text not null,
  observation_count bigint not null default 0,
  match_count bigint not null default 0,
  mismatch_count bigint not null default 0,
  resolver_error_count bigint not null default 0,
  envelope_error_count bigint not null default 0,
  first_observed_at timestamptz not null default now(),
  last_observed_at timestamptz not null default now(),
  last_match_at timestamptz,
  last_failure_at timestamptz,
  last_failure_code text,
  updated_at timestamptz not null default now(),
  constraint connector_adapter_route_health_counts_nonnegative check (
    observation_count >= 0
    and match_count >= 0
    and mismatch_count >= 0
    and resolver_error_count >= 0
    and envelope_error_count >= 0
  ),
  constraint connector_adapter_route_health_counts_balance check (
    observation_count = match_count + mismatch_count
      + resolver_error_count + envelope_error_count
  ),
  constraint connector_adapter_route_health_code_format check (
    last_failure_code is null
    or last_failure_code ~ '^[a-z0-9_]{1,64}$'
  )
);

comment on table public.connector_adapter_route_health is
  'Service-only aggregate provider-adapter route rollout evidence. Contains counters and redacted codes only; never payloads, provider references, account IDs, or credentials.';

alter table public.connector_adapter_route_health enable row level security;
revoke all on table public.connector_adapter_route_health
  from public, anon, authenticated;
grant select, insert, update on public.connector_adapter_route_health
  to service_role;

create or replace function public.record_connector_adapter_route_observation(
  p_device_credential_id uuid,
  p_outcome text,
  p_failure_code text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_installation_id uuid;
  v_connector_key text;
  v_observed_at timestamptz := clock_timestamp();
begin
  if p_outcome not in ('match', 'mismatch', 'resolver_error', 'envelope_error') then
    raise exception 'adapter_route_outcome_invalid' using errcode = '22023';
  end if;
  if p_outcome = 'match' and p_failure_code is not null then
    raise exception 'adapter_route_match_code_invalid' using errcode = '22023';
  end if;
  if p_outcome <> 'match' and (
    p_failure_code is null
    or p_failure_code !~ '^[a-z0-9_]{1,64}$'
  ) then
    raise exception 'adapter_route_failure_code_invalid' using errcode = '22023';
  end if;

  select dc.connector_installation_id, ci.connector_key
  into v_installation_id, v_connector_key
  from public.device_credentials dc
  join public.connector_installations ci
    on ci.id = dc.connector_installation_id
  where dc.id = p_device_credential_id;

  if not found then
    raise exception 'adapter_route_credential_unknown' using errcode = '22023';
  end if;

  insert into public.connector_adapter_route_health (
    connector_installation_id,
    connector_key,
    observation_count,
    match_count,
    mismatch_count,
    resolver_error_count,
    envelope_error_count,
    first_observed_at,
    last_observed_at,
    last_match_at,
    last_failure_at,
    last_failure_code,
    updated_at
  ) values (
    v_installation_id,
    v_connector_key,
    1,
    case when p_outcome = 'match' then 1 else 0 end,
    case when p_outcome = 'mismatch' then 1 else 0 end,
    case when p_outcome = 'resolver_error' then 1 else 0 end,
    case when p_outcome = 'envelope_error' then 1 else 0 end,
    v_observed_at,
    v_observed_at,
    case when p_outcome = 'match' then v_observed_at else null end,
    case when p_outcome <> 'match' then v_observed_at else null end,
    p_failure_code,
    v_observed_at
  )
  on conflict (connector_installation_id) do update
  set connector_key = excluded.connector_key,
      observation_count = connector_adapter_route_health.observation_count + 1,
      match_count = connector_adapter_route_health.match_count
        + case when p_outcome = 'match' then 1 else 0 end,
      mismatch_count = connector_adapter_route_health.mismatch_count
        + case when p_outcome = 'mismatch' then 1 else 0 end,
      resolver_error_count = connector_adapter_route_health.resolver_error_count
        + case when p_outcome = 'resolver_error' then 1 else 0 end,
      envelope_error_count = connector_adapter_route_health.envelope_error_count
        + case when p_outcome = 'envelope_error' then 1 else 0 end,
      last_observed_at = v_observed_at,
      last_match_at = case
        when p_outcome = 'match' then v_observed_at
        else connector_adapter_route_health.last_match_at
      end,
      last_failure_at = case
        when p_outcome <> 'match' then v_observed_at
        else connector_adapter_route_health.last_failure_at
      end,
      last_failure_code = case
        when p_outcome <> 'match' then p_failure_code
        else connector_adapter_route_health.last_failure_code
      end,
      updated_at = v_observed_at;
end;
$$;

comment on function public.record_connector_adapter_route_observation(uuid, text, text) is
  'Service-only aggregate provider-adapter route outcome recorder. Installation and connector key are derived from the canonical credential; only redacted codes are accepted.';
revoke all on function public.record_connector_adapter_route_observation(uuid, text, text)
  from public;
grant execute on function public.record_connector_adapter_route_observation(uuid, text, text)
  to service_role;
