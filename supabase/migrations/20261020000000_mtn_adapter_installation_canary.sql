-- Installation-scoped MTN adapter canary and pairing workflow.
--
-- The provider flag remains a coarse emergency switch. This table is the
-- authoritative fine-grained gate: at most one installation for a connector
-- key can be enabled during the initial canary. Pairing binds hashed provider
-- identity onto the canonical source/account that already backs the legacy
-- connection; it never creates a second ledger route and never accepts or
-- stores a raw MSISDN.

create table public.connector_adapter_canaries (
  connector_installation_id uuid primary key
    references public.connector_installations(id) on delete cascade,
  connector_key text not null,
  enabled boolean not null default false,
  paired_at timestamptz not null default now(),
  paired_by uuid not null references auth.users(id),
  enabled_at timestamptz,
  enabled_by uuid references auth.users(id),
  disabled_at timestamptz,
  disabled_by uuid references auth.users(id),
  baseline_observation_count bigint not null default 0,
  baseline_match_count bigint not null default 0,
  baseline_mismatch_count bigint not null default 0,
  baseline_resolver_error_count bigint not null default 0,
  baseline_envelope_error_count bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint connector_adapter_canaries_enabled_state check (
    (enabled and enabled_at is not null and enabled_by is not null
      and disabled_at is null and disabled_by is null)
    or
    (not enabled and (
      (enabled_at is null and enabled_by is null
        and disabled_at is null and disabled_by is null)
      or
      (enabled_at is not null and enabled_by is not null
        and disabled_at is not null and disabled_by is not null)
    ))
  ),
  constraint connector_adapter_canaries_baselines_nonnegative check (
    baseline_observation_count >= 0
    and baseline_match_count >= 0
    and baseline_mismatch_count >= 0
    and baseline_resolver_error_count >= 0
    and baseline_envelope_error_count >= 0
  ),
  constraint connector_adapter_canaries_baselines_balance check (
    baseline_observation_count = baseline_match_count
      + baseline_mismatch_count + baseline_resolver_error_count
      + baseline_envelope_error_count
  )
);

create unique index connector_adapter_canaries_one_enabled_per_connector
  on public.connector_adapter_canaries(connector_key)
  where enabled;

create trigger set_connector_adapter_canaries_updated_at
  before update on public.connector_adapter_canaries
  for each row execute function public.set_updated_at();

comment on table public.connector_adapter_canaries is
  'Installation allowlist for the initial provider-adapter canary. Contains only canonical IDs, rollout state, and health baselines; raw provider references and credentials are forbidden.';

alter table public.connector_adapter_canaries enable row level security;
revoke all on table public.connector_adapter_canaries
  from public, anon, authenticated;
grant select, insert, update, delete on public.connector_adapter_canaries
  to service_role;

create or replace function public.pair_mtn_momo_adapter_canary(
  p_ingestion_connection_id uuid,
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
  v_installation_id uuid;
  v_credential_id uuid;
  v_source_id uuid;
  v_account_id uuid;
  v_workspace_id uuid;
  v_current_source_hash text;
  v_current_account_hash text;
  v_health public.connector_adapter_route_health%rowtype;
  v_route record;
  v_now timestamptz := clock_timestamp();
begin
  perform public.require_progressive_mfa();

  if not public.is_platform_admin() then
    raise exception 'adapter_canary_admin_required' using errcode = '42501';
  end if;

  if p_source_ref_hash is null
    or p_source_ref_hash !~ '^[0-9a-f]{64}$'
    or p_account_ref_hash is null
    or p_account_ref_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'adapter_canary_discriminator_invalid' using errcode = '22023';
  end if;
  if p_masked_identifier is null
    or length(btrim(p_masked_identifier)) < 4
    or length(btrim(p_masked_identifier)) > 64
    or length(regexp_replace(p_masked_identifier, '[^0-9]', '', 'g')) > 4 then
    raise exception 'adapter_canary_mask_invalid' using errcode = '22023';
  end if;

  select
    ic.connector_installation_id,
    ic.device_credential_id,
    fs.id,
    a.id,
    a.workspace_id,
    fs.external_source_ref_hash,
    a.external_account_ref_hash
  into
    v_installation_id,
    v_credential_id,
    v_source_id,
    v_account_id,
    v_workspace_id,
    v_current_source_hash,
    v_current_account_hash
  from public.ingestion_connections ic
  join public.connector_installations ci
    on ci.id = ic.connector_installation_id
  join public.device_credentials dc
    on dc.id = ic.device_credential_id
    and dc.connector_installation_id = ci.id
  join public.accounts a
    on a.id = ic.account_id
    and a.id = dc.account_id
    and a.workspace_id = ic.workspace_id
  join public.financial_sources fs
    on fs.id = a.financial_source_id
    and fs.connector_installation_id = ci.id
  where ic.id = p_ingestion_connection_id
    and ci.owner_user_id = auth.uid()
    and ci.connector_key = 'mtn_momo_sms_v1'
    and ci.status not in ('paused', 'revoked')
    and ic.status = 'active'
    and dc.status = 'active'
    and (dc.expires_at is null or dc.expires_at > statement_timestamp())
    and a.is_active
    and a.archived_at is null
    and fs.status = 'active'
    and fs.provider = 'mtn_momo'
  for update of ic, ci, dc, a, fs;

  if not found then
    raise exception 'adapter_canary_route_unavailable' using errcode = '22023';
  end if;
  if v_current_source_hash is not null
    and v_current_source_hash is distinct from p_source_ref_hash then
    raise exception 'adapter_canary_source_already_paired' using errcode = '22023';
  end if;
  if v_current_account_hash is not null
    and v_current_account_hash is distinct from p_account_ref_hash then
    raise exception 'adapter_canary_account_already_paired' using errcode = '22023';
  end if;

  update public.financial_sources
  set provider_key = 'mtn_momo_sms_v1',
      external_source_ref_hash = p_source_ref_hash,
      masked_identifier = btrim(p_masked_identifier)
  where id = v_source_id;

  update public.accounts
  set external_account_ref_hash = p_account_ref_hash
  where id = v_account_id;

  select * into v_route
  from public.resolve_connector_event_route(
    v_credential_id,
    p_source_ref_hash,
    p_account_ref_hash
  );

  if not found
    or v_route.connector_installation_id is distinct from v_installation_id
    or v_route.device_credential_id is distinct from v_credential_id
    or v_route.financial_source_id is distinct from v_source_id
    or v_route.account_id is distinct from v_account_id
    or v_route.workspace_id is distinct from v_workspace_id then
    raise exception 'adapter_canary_route_verification_failed' using errcode = '22023';
  end if;

  select * into v_health
  from public.connector_adapter_route_health h
  where h.connector_installation_id = v_installation_id;

  insert into public.connector_adapter_canaries (
    connector_installation_id,
    connector_key,
    enabled,
    paired_at,
    paired_by,
    enabled_at,
    enabled_by,
    disabled_at,
    disabled_by,
    baseline_observation_count,
    baseline_match_count,
    baseline_mismatch_count,
    baseline_resolver_error_count,
    baseline_envelope_error_count
  ) values (
    v_installation_id,
    'mtn_momo_sms_v1',
    true,
    v_now,
    auth.uid(),
    v_now,
    auth.uid(),
    null,
    null,
    coalesce(v_health.observation_count, 0),
    coalesce(v_health.match_count, 0),
    coalesce(v_health.mismatch_count, 0),
    coalesce(v_health.resolver_error_count, 0),
    coalesce(v_health.envelope_error_count, 0)
  )
  on conflict (connector_installation_id) do update
  set connector_key = excluded.connector_key,
      enabled = true,
      paired_at = excluded.paired_at,
      paired_by = excluded.paired_by,
      enabled_at = excluded.enabled_at,
      enabled_by = excluded.enabled_by,
      disabled_at = null,
      disabled_by = null,
      baseline_observation_count = excluded.baseline_observation_count,
      baseline_match_count = excluded.baseline_match_count,
      baseline_mismatch_count = excluded.baseline_mismatch_count,
      baseline_resolver_error_count = excluded.baseline_resolver_error_count,
      baseline_envelope_error_count = excluded.baseline_envelope_error_count;

  return v_installation_id;
exception
  when unique_violation then
    raise exception 'adapter_canary_slot_unavailable' using errcode = '22023';
end;
$$;

comment on function public.pair_mtn_momo_adapter_canary(uuid, text, text, text) is
  'Owner/MFA-gated MTN canary pairing. Accepts hashes only, binds the existing canonical route, proves deterministic resolution, and enables exactly that installation.';
revoke all on function public.pair_mtn_momo_adapter_canary(uuid, text, text, text)
  from public;
grant execute on function public.pair_mtn_momo_adapter_canary(uuid, text, text, text)
  to authenticated;

create or replace function public.set_connector_adapter_canary_enabled(
  p_connector_installation_id uuid,
  p_enabled boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_health public.connector_adapter_route_health%rowtype;
begin
  perform public.require_progressive_mfa();

  if p_enabled is null then
    raise exception 'adapter_canary_enabled_invalid' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.connector_adapter_canaries canary
    join public.connector_installations ci
      on ci.id = canary.connector_installation_id
    where canary.connector_installation_id = p_connector_installation_id
      and ci.owner_user_id = auth.uid()
      and ci.status not in ('paused', 'revoked')
  ) then
    raise exception 'adapter_canary_unavailable' using errcode = '22023';
  end if;

  if p_enabled then
    select * into v_health
    from public.connector_adapter_route_health h
    where h.connector_installation_id = p_connector_installation_id;

    update public.connector_adapter_canaries
    set enabled = true,
        enabled_at = v_now,
        enabled_by = auth.uid(),
        disabled_at = null,
        disabled_by = null,
        baseline_observation_count = coalesce(v_health.observation_count, 0),
        baseline_match_count = coalesce(v_health.match_count, 0),
        baseline_mismatch_count = coalesce(v_health.mismatch_count, 0),
        baseline_resolver_error_count = coalesce(v_health.resolver_error_count, 0),
        baseline_envelope_error_count = coalesce(v_health.envelope_error_count, 0)
    where connector_installation_id = p_connector_installation_id;
  else
    update public.connector_adapter_canaries
    set enabled = false,
        disabled_at = v_now,
        disabled_by = auth.uid()
    where connector_installation_id = p_connector_installation_id;
  end if;
exception
  when unique_violation then
    raise exception 'adapter_canary_slot_unavailable' using errcode = '22023';
end;
$$;

comment on function public.set_connector_adapter_canary_enabled(uuid, boolean) is
  'Owner/MFA-gated kill switch for a previously paired installation. Re-enabling resets the health evaluation baseline.';
revoke all on function public.set_connector_adapter_canary_enabled(uuid, boolean)
  from public;
grant execute on function public.set_connector_adapter_canary_enabled(uuid, boolean)
  to authenticated;

create or replace function public.get_connector_adapter_canary_status()
returns table (
  connector_installation_id uuid,
  enabled boolean,
  paired_at timestamptz,
  enabled_at timestamptz,
  observation_count bigint,
  match_count bigint,
  mismatch_count bigint,
  resolver_error_count bigint,
  envelope_error_count bigint,
  ready_for_broader_rollout boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select
    canary.connector_installation_id,
    canary.enabled,
    canary.paired_at,
    canary.enabled_at,
    greatest(coalesce(health.observation_count, 0)
      - canary.baseline_observation_count, 0),
    greatest(coalesce(health.match_count, 0)
      - canary.baseline_match_count, 0),
    greatest(coalesce(health.mismatch_count, 0)
      - canary.baseline_mismatch_count, 0),
    greatest(coalesce(health.resolver_error_count, 0)
      - canary.baseline_resolver_error_count, 0),
    greatest(coalesce(health.envelope_error_count, 0)
      - canary.baseline_envelope_error_count, 0),
    canary.enabled
      and greatest(coalesce(health.observation_count, 0)
        - canary.baseline_observation_count, 0) >= 5
      and greatest(coalesce(health.mismatch_count, 0)
        - canary.baseline_mismatch_count, 0) = 0
      and greatest(coalesce(health.resolver_error_count, 0)
        - canary.baseline_resolver_error_count, 0) = 0
      and greatest(coalesce(health.envelope_error_count, 0)
        - canary.baseline_envelope_error_count, 0) = 0
  from public.connector_adapter_canaries canary
  join public.connector_installations ci
    on ci.id = canary.connector_installation_id
  left join public.connector_adapter_route_health health
    on health.connector_installation_id = canary.connector_installation_id
  where auth.uid() is not null
    and ci.owner_user_id = auth.uid();
$$;

comment on function public.get_connector_adapter_canary_status() is
  'Owner-visible redacted canary counters since the latest enable. Five clean matches are required before broader rollout is considered ready.';
revoke all on function public.get_connector_adapter_canary_status() from public;
grant execute on function public.get_connector_adapter_canary_status()
  to authenticated;
