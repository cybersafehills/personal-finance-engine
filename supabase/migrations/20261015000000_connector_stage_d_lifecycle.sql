-- Connector model Stage D: canonical-authoritative reversible lifecycle and
-- display-name mutations. The legacy row is still maintained atomically for
-- rollback and shadow comparison, but authenticated callers mutate through
-- the installation boundary instead of writing either table directly.

alter table public.connector_installations
  add column pre_pause_status text
    check (
      pre_pause_status is null
      or (
        status = 'paused'
        and pre_pause_status in ('setup', 'testing', 'healthy', 'stale', 'error')
      )
    );

comment on column public.connector_installations.pre_pause_status is
  'Internal reversible-lifecycle state. Canonical-only installations resume to this status; legacy-backed installations resume to healthy for shadow compatibility.';

create or replace function public.normalize_connector_installation_pause_state()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status <> 'paused' then
    new.pre_pause_status := null;
  elsif old.status <> 'paused'
    and new.pre_pause_status is null
    and old.status in ('setup', 'testing', 'healthy', 'stale', 'error') then
    new.pre_pause_status := old.status;
  end if;

  return new;
end;
$$;

comment on function public.normalize_connector_installation_pause_state is
  'Internal invariant trigger. Clears stale reversible-pause metadata on every non-paused transition, including service repairs and the rollback mirror.';
revoke all on function public.normalize_connector_installation_pause_state() from public;

create trigger normalize_connector_installation_pause_state
  before update of status, pre_pause_status on public.connector_installations
  for each row execute function public.normalize_connector_installation_pause_state();

alter table public.device_credentials
  add column paused_by_installation boolean not null default false,
  add constraint device_credentials_installation_pause_consistent check (
    not paused_by_installation or status = 'paused'
  );

comment on column public.device_credentials.paused_by_installation is
  'Internal marker that prevents installation resume from reactivating a credential paused independently.';

-- Extend the Stage C legacy mirror so rollback-path mutations maintain the
-- Stage D pause metadata too. Credential secrets remain mirror-only here;
-- canonical credential rotation is introduced in a separate migration.
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
      pre_pause_status = case
        when new.status = 'paused' then
          case when status = 'paused' then pre_pause_status else status end
        else null
      end,
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
      revoked_at = new.revoked_at,
      paused_by_installation = new.status = 'paused'
  where id = new.device_credential_id
    and connector_installation_id = new.connector_installation_id
    and legacy_ingestion_connection_id = new.id;

  return new;
end;
$$;

comment on function public.sync_legacy_connection_to_canonical is
  'Internal Stage C/D rollback mirror. Keeps a legacy-backed canonical installation and its mapped credential synchronized while compatibility writes remain available.';
revoke all on function public.sync_legacy_connection_to_canonical() from public;

create or replace function public.set_connector_installation_paused(
  p_connector_installation_id uuid,
  p_paused boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_pre_pause_status text;
  v_has_legacy boolean;
  v_now timestamptz := clock_timestamp();
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if p_paused is null then
    raise exception 'Pause state is required.';
  end if;

  select ci.status, ci.pre_pause_status,
    ci.legacy_ingestion_connection_id is not null
  into v_status, v_pre_pause_status, v_has_legacy
  from public.connector_installations ci
  where ci.id = p_connector_installation_id
    and ci.owner_user_id = auth.uid()
  for update;

  if not found then
    raise exception 'Connector installation not found.';
  end if;

  if v_status = 'revoked' then
    raise exception 'A revoked connector installation cannot change pause state.';
  end if;

  if p_paused then
    update public.connector_installations
    set pre_pause_status = case
          when status = 'paused' then pre_pause_status
          else status
        end,
        status = 'paused'
    where id = p_connector_installation_id;

    update public.device_credentials
    set status = 'paused',
        paused_at = v_now,
        paused_by_installation = true
    where connector_installation_id = p_connector_installation_id
      and status = 'active';

    -- This fires the compatibility trigger, which is deliberately
    -- idempotent with the canonical writes above.
    update public.ingestion_connections
    set status = 'paused',
        paused_at = v_now
    where connector_installation_id = p_connector_installation_id
      and status = 'active';
  else
    if v_status <> 'paused' then
      return;
    end if;

    update public.ingestion_connections
    set status = 'active',
        paused_at = null
    where connector_installation_id = p_connector_installation_id
      and status = 'paused';

    update public.device_credentials
    set status = 'active',
        paused_at = null,
        paused_by_installation = false
    where connector_installation_id = p_connector_installation_id
      and status = 'paused'
      and paused_by_installation;

    update public.connector_installations
    set status = case
          when v_has_legacy then 'healthy'
          else coalesce(v_pre_pause_status, 'healthy')
        end,
        pre_pause_status = null
    where id = p_connector_installation_id;
  end if;
end;
$$;

comment on function public.set_connector_installation_paused(uuid, boolean) is
  'Owner-scoped Stage D pause/resume. Mutates the canonical installation and affected credentials, plus any Stage C legacy compatibility row, in one transaction.';
revoke all on function public.set_connector_installation_paused(uuid, boolean) from public;
grant execute on function public.set_connector_installation_paused(uuid, boolean) to authenticated;

create or replace function public.rename_connector_installation(
  p_connector_installation_id uuid,
  p_display_name text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_display_name text := trim(p_display_name);
  v_legacy_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if v_display_name is null or v_display_name = '' then
    raise exception 'Connector display name cannot be empty.';
  end if;

  select ci.legacy_ingestion_connection_id
  into v_legacy_id
  from public.connector_installations ci
  where ci.id = p_connector_installation_id
    and ci.owner_user_id = auth.uid()
    and ci.status <> 'revoked'
  for update;

  if not found then
    raise exception 'Active connector installation not found.';
  end if;

  update public.connector_installations
  set display_name = v_display_name
  where id = p_connector_installation_id;

  if v_legacy_id is not null then
    update public.ingestion_connections
    set label = v_display_name
    where id = v_legacy_id
      and connector_installation_id = p_connector_installation_id;
  end if;
end;
$$;

comment on function public.rename_connector_installation(uuid, text) is
  'Owner-scoped Stage D installation rename with atomic Stage C legacy compatibility. Device labels remain independent for canonical-only multi-device installations.';
revoke all on function public.rename_connector_installation(uuid, text) from public;
grant execute on function public.rename_connector_installation(uuid, text) to authenticated;
