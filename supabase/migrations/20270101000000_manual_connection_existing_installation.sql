-- Manual "Connect a device" on an account that is already connected.
--
-- Root cause (same shape as the pairing bug fixed in 20261126000000 /
-- 20261127000000, on the path those migrations did not touch):
-- create_ingestion_connection_dual_write always called
-- _enroll_ingestion_connection, i.e. first-time enrollment. When the account's
-- financial_source already has a connector_installation (any earlier
-- connection, active, paused or revoked), backfill_legacy_ingestion_connection
-- hits connector_stage_b_preflight, which correctly refuses to map one
-- financial_source to a second installation (source_already_attached) and
-- rolls the statement back. The web action turned that into a generic "Could
-- not create the connection." - so an owner who revoked a connection could
-- never set one up again from the form.
--
-- Fix, by the state of the existing installation:
--   * none     -> first-time enrollment, exactly as before;
--   * active / paused -> refuse with a typed `account_already_connected`
--     error. A second working key per account is not possible in this model,
--     and silently rotating would cut off the phone that is working today.
--     The web form tells the owner to reconnect the existing connection.
--   * revoked  -> restore it with the new key on the SAME legacy
--     ingestion_connections row (mirrors consume_device_pairing_session's
--     rotation in 20261127000000): the newest legacy-mapped credential
--     releases its backlink, a new active credential inherits it, and the
--     legacy row and installation come back active/healthy. No credential is
--     live at that point, so nothing working is cut off.
--
-- _enroll_ingestion_connection, backfill_legacy_ingestion_connection and the
-- Stage B preflight are unchanged.

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
  v_uid uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_installation_id uuid;
  v_source_owner uuid;
  v_install_status text;
  v_install_owner uuid;
  v_legacy_id uuid;
  v_old_credential_id uuid;
  v_new_credential_id uuid;
begin
  if v_uid is null then
    raise exception 'Authentication required.';
  end if;

  if not public.is_workspace_member(p_workspace_id, 'owner') then
    raise exception 'Only a workspace owner can create a connection.';
  end if;

  -- Lock the account (as _enroll_ingestion_connection does) so a concurrent
  -- create cannot race this branch decision.
  select fs.connector_installation_id, fs.owner_user_id
  into v_installation_id, v_source_owner
  from public.accounts a
  left join public.financial_sources fs on fs.id = a.financial_source_id
  where a.id = p_account_id
    and a.workspace_id = p_workspace_id
    and a.is_active
    and a.archived_at is null
  for update of a;

  if v_installation_id is null then
    -- No installation yet (or the account is unavailable, which enrollment
    -- reports itself): first-time enrollment, unchanged.
    return public._enroll_ingestion_connection(
      v_uid, p_workspace_id, p_account_id, p_label, p_provider,
      p_credential_hash, p_credential_prefix
    );
  end if;

  if v_source_owner is distinct from v_uid then
    raise exception 'The financial source is owned by another user.';
  end if;

  select ci.status, ci.owner_user_id, ci.legacy_ingestion_connection_id
  into v_install_status, v_install_owner, v_legacy_id
  from public.connector_installations ci
  where ci.id = v_installation_id
  for update;

  if v_install_owner is distinct from v_uid then
    raise exception 'The financial source is owned by another user.';
  end if;

  if v_install_status is distinct from 'revoked' then
    raise exception 'account_already_connected'
      using errcode = 'P0001',
            hint = 'Reconnect the existing connection instead of creating a new one.';
  end if;

  -- Revoked: restore on the same legacy row. Only possible when that row
  -- belongs to this account in this workspace; anything else (a
  -- canonical-only installation, a source projected from another Space) is
  -- reported as already connected rather than guessed at.
  perform 1
  from public.ingestion_connections ic
  where ic.id = v_legacy_id
    and ic.account_id = p_account_id
    and ic.workspace_id = p_workspace_id
  for update;

  if v_legacy_id is null or not found then
    raise exception 'account_already_connected'
      using errcode = 'P0001',
            hint = 'This connection cannot be restored from here.';
  end if;

  -- Bringing a revoked connection back is as sensitive as a rotation.
  perform public.require_progressive_mfa();

  if p_credential_hash is null or p_credential_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Credential hash must be a lowercase SHA-256 digest.';
  end if;

  if p_credential_prefix is null or p_credential_prefix !~ '^pfe_[A-Za-z0-9_-]{4}$' then
    raise exception 'Credential prefix is invalid.';
  end if;

  -- revoke_connector_installation leaves each revoked credential's legacy
  -- backlink in place; release the newest one so the successor can inherit it
  -- (device_credentials_legacy_connection_unique: one credential per row).
  select dc.id
  into v_old_credential_id
  from public.device_credentials dc
  where dc.connector_installation_id = v_installation_id
    and dc.legacy_ingestion_connection_id = v_legacy_id
  order by dc.created_at desc
  limit 1
  for update;

  if v_old_credential_id is not null then
    update public.device_credentials
    set legacy_ingestion_connection_id = null,
        status = 'revoked',
        revoked_at = coalesce(revoked_at, v_now),
        paused_by_installation = false
    where id = v_old_credential_id;
  end if;

  insert into public.device_credentials (
    connector_installation_id, account_id, label,
    credential_hash, credential_prefix, status,
    created_by, legacy_ingestion_connection_id, rotated_from_id
  ) values (
    v_installation_id, p_account_id, trim(p_label),
    p_credential_hash, p_credential_prefix, 'active',
    v_uid, v_legacy_id, v_old_credential_id
  ) returning id into v_new_credential_id;

  update public.ingestion_connections
  set credential_hash = p_credential_hash,
      credential_prefix = p_credential_prefix,
      device_credential_id = v_new_credential_id,
      label = trim(p_label),
      status = 'active',
      revoked_at = null,
      paused_at = null
  where id = v_legacy_id;

  update public.connector_installations
  set status = 'healthy',
      revoked_at = null,
      pre_pause_status = null
  where id = v_installation_id;

  return v_legacy_id;
end;
$$;

comment on function public.create_ingestion_connection_dual_write(uuid, uuid, text, text, text, text) is
  'Owner-only manual connection. First-time enrollment for an unconnected account; account_already_connected for an active/paused one; restores a revoked one on its existing legacy row with the new key.';
revoke all on function public.create_ingestion_connection_dual_write(uuid, uuid, text, text, text, text) from public;
grant execute on function public.create_ingestion_connection_dual_write(uuid, uuid, text, text, text, text) to authenticated;
