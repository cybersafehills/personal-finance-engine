-- Connector model Stage D: immutable device-credential rotation history and
-- one-way installation revocation. Ingestion remains legacy-authoritative,
-- so a mapped legacy row receives the new active credential or revoked state
-- in the same transaction for rollback and shadow parity.

create or replace function public.require_progressive_mfa()
returns void
language plpgsql
security definer
set search_path = auth, pg_catalog
as $$
declare
  v_has_verified_factor boolean;
  v_aal text := coalesce(auth.jwt() ->> 'aal', 'aal1');
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  select exists (
    select 1
    from auth.mfa_factors factor
    where factor.user_id = auth.uid()
      and factor.status = 'verified'
  ) into v_has_verified_factor;

  if v_has_verified_factor and v_aal <> 'aal2' then
    raise exception 'Multi-factor authentication required.'
      using errcode = '42501';
  end if;
end;
$$;

comment on function public.require_progressive_mfa() is
  'Internal defense-in-depth guard for sensitive RPCs: users with a verified MFA factor must present an aal2 JWT; users without a factor retain progressive access.';
revoke all on function public.require_progressive_mfa() from public;

create or replace function public.rotate_device_credential(
  p_device_credential_id uuid,
  p_credential_hash text,
  p_credential_prefix text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_installation_id uuid;
  v_account_id uuid;
  v_label text;
  v_expires_at timestamptz;
  v_legacy_id uuid;
  v_new_credential_id uuid;
  v_now timestamptz := clock_timestamp();
begin
  perform public.require_progressive_mfa();

  if p_credential_hash is null
    or p_credential_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Credential hash must be a lowercase SHA-256 digest.';
  end if;

  if p_credential_prefix is null
    or p_credential_prefix !~ '^pfe_[A-Za-z0-9_-]{4}$' then
    raise exception 'Credential prefix is invalid.';
  end if;

  select
    dc.connector_installation_id,
    dc.account_id,
    dc.label,
    dc.expires_at,
    dc.legacy_ingestion_connection_id
  into
    v_installation_id,
    v_account_id,
    v_label,
    v_expires_at,
    v_legacy_id
  from public.device_credentials dc
  join public.connector_installations ci
    on ci.id = dc.connector_installation_id
  where dc.id = p_device_credential_id
    and dc.status = 'active'
    and ci.owner_user_id = auth.uid()
    and ci.status not in ('paused', 'revoked')
  for update of ci, dc;

  if not found then
    raise exception 'Active device credential not found.';
  end if;

  -- Release the one-to-one compatibility backlink before assigning it to the
  -- successor. The old row, hash, usage history, and raw-event provenance are
  -- retained permanently.
  update public.device_credentials
  set status = 'revoked',
      revoked_at = v_now,
      paused_by_installation = false,
      legacy_ingestion_connection_id = null
  where id = p_device_credential_id;

  insert into public.device_credentials (
    connector_installation_id,
    account_id,
    label,
    credential_hash,
    credential_prefix,
    status,
    expires_at,
    rotated_from_id,
    created_by,
    legacy_ingestion_connection_id
  ) values (
    v_installation_id,
    v_account_id,
    v_label,
    p_credential_hash,
    p_credential_prefix,
    'active',
    v_expires_at,
    p_device_credential_id,
    auth.uid(),
    v_legacy_id
  ) returning id into v_new_credential_id;

  if v_legacy_id is not null then
    update public.ingestion_connections
    set credential_hash = p_credential_hash,
        credential_prefix = p_credential_prefix,
        device_credential_id = v_new_credential_id
    where id = v_legacy_id
      and connector_installation_id = v_installation_id
      and device_credential_id = p_device_credential_id
      and status = 'active';

    if not found then
      raise exception 'Legacy credential mapping changed during rotation.';
    end if;
  end if;

  return v_new_credential_id;
end;
$$;

comment on function public.rotate_device_credential(uuid, text, text) is
  'MFA-aware owner rotation. Creates an active successor, revokes but retains the predecessor, and atomically advances any Stage C legacy mapping.';
revoke all on function public.rotate_device_credential(uuid, text, text) from public;
grant execute on function public.rotate_device_credential(uuid, text, text) to authenticated;

create or replace function public.revoke_connector_installation(
  p_connector_installation_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_now timestamptz := clock_timestamp();
begin
  perform public.require_progressive_mfa();

  select ci.status
  into v_status
  from public.connector_installations ci
  where ci.id = p_connector_installation_id
    and ci.owner_user_id = auth.uid()
  for update;

  if not found then
    raise exception 'Connector installation not found.';
  end if;

  if v_status = 'revoked' then
    return;
  end if;

  update public.device_credentials
  set status = 'revoked',
      revoked_at = v_now,
      paused_by_installation = false
  where connector_installation_id = p_connector_installation_id
    and status <> 'revoked';

  -- The compatibility trigger is idempotent with the canonical writes and
  -- immediately disables the legacy authentication path used by ingestion.
  update public.ingestion_connections
  set status = 'revoked',
      revoked_at = v_now
  where connector_installation_id = p_connector_installation_id
    and status <> 'revoked';

  update public.connector_installations
  set status = 'revoked',
      revoked_at = v_now,
      pre_pause_status = null
  where id = p_connector_installation_id;
end;
$$;

comment on function public.revoke_connector_installation(uuid) is
  'MFA-aware owner revocation. Permanently revokes an installation, all of its credentials, and any Stage C legacy authentication row without deleting provenance.';
revoke all on function public.revoke_connector_installation(uuid) from public;
grant execute on function public.revoke_connector_installation(uuid) to authenticated;
