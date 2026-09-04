-- Fix device re-pairing, take 2 (device pairing v2, ADR 0008). 20261126000000
-- stopped the PAIRING_INVALID collision on re-pair, but its "existing
-- installation" branch used the wrong mechanism: it minted an *additional*
-- device_credentials row with legacy_ingestion_connection_id = NULL.
--
-- resolve_canonical_ingestion_credential (Stage D dual-write,
-- 20261017000000_connector_stage_d_canonical_auth.sql) - the RPC op:"capture"
-- authenticates against - REQUIRES legacy_ingestion_connection_id IS NOT NULL
-- ("a canonical credential without a legacy mapping cannot safely enter the
-- old downstream write path") and connector_installations.status NOT IN
-- ('paused', 'revoked'). A credential minted with a NULL legacy id can
-- therefore never authenticate a capture call - the re-pair "succeeded" but
-- produced a key that could never actually be used. Confirmed live: two
-- device_credentials rows minted this way, both permanently unauthenticatable,
-- while the account's connector_installation sat at status='revoked' this
-- whole time (surfacing as "Disabled" on the Connections page) - a second,
-- independent block that would have defeated even a correctly-linked
-- credential.
--
-- The codebase already has the correct mechanism for "issue a new key for an
-- existing installation": rotate_device_credential
-- (20261016000000_connector_stage_d_credential_history.sql). It revokes the
-- old credential, releasing its legacy backlink, and mints a new one that
-- *inherits* that legacy_ingestion_connection_id, then repoints
-- ingestion_connections.device_credential_id (+ hash/prefix) at it - keeping
-- the Stage D dual-write invariant (`device_credentials_legacy_connection_
-- unique`: at most one credential per legacy row) intact throughout.
--
-- Fix: consume_device_pairing_session's existing-installation branch now
-- does the same rotation instead of minting a parallel credential. A
-- successful re-pair is unambiguous, MFA-gated owner intent to make this
-- connection live again, so it also reactivates the installation and its
-- legacy ingestion_connections row (mirroring backfill_legacy_ingestion_
-- connection's own "active -> healthy" status mapping) - re-pairing a
-- revoked connection un-revokes it, which is exactly what a user pairing
-- their phone again expects to happen.
--
-- Falls back to minting an unlinked credential only when the installation
-- genuinely has no legacy-mapped credential to rotate (a canonical-only
-- installation, never enrolled through the legacy path) - unreachable from
-- this wizard today (every installation it can reach was created via
-- _enroll_ingestion_connection, which always creates a legacy row), kept for
-- forward compatibility with a future canonical-only cutover.

create or replace function public.consume_device_pairing_session(
  p_token_hash text,
  p_new_credential_hash text,
  p_new_credential_prefix text,
  p_client_version text,
  p_platform text,
  p_device_label text default null::text
)
returns table(device_credential_id uuid, connector_installation_id uuid, legacy_ingestion_connection_id uuid)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_session public.pairing_sessions%rowtype;
  v_now timestamptz := clock_timestamp();
  v_connection_id uuid;
  v_installation_id uuid;
  v_credential_id uuid;
  v_old_credential_id uuid;
  v_legacy_id uuid;
  v_account_id uuid;
  v_label text;
begin
  -- Failure paths RAISE, which rolls back everything this function did in the
  -- current statement - so this function does not try to persist failure
  -- audit rows. The Edge Function that calls it catches the typed error and
  -- writes the redacted connector_pairing_events row itself. Replay/brute
  -- force is bounded by the 10-minute TTL, single use, 128-bit token entropy,
  -- and the caller's rate limiter.
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'PAIRING_INVALID' using errcode = '22023';
  end if;

  select * into v_session
  from public.pairing_sessions
  where token_hash = p_token_hash
  for update;

  if not found then
    raise exception 'PAIRING_INVALID' using errcode = '22023';
  end if;

  if v_session.status = 'consumed' then
    raise exception 'PAIRING_ALREADY_USED' using errcode = '22023';
  end if;

  if v_session.status in ('expired', 'cancelled') or v_session.expires_at <= v_now then
    if v_session.status = 'pending' then
      update public.pairing_sessions set status = 'expired' where id = v_session.id;
    end if;
    raise exception 'PAIRING_EXPIRED' using errcode = '22023';
  end if;

  if p_new_credential_hash is null or p_new_credential_hash !~ '^[0-9a-f]{64}$'
     or p_new_credential_prefix is null or p_new_credential_prefix !~ '^pfe_[A-Za-z0-9_-]{4}$' then
    raise exception 'PAIRING_BAD_CREDENTIAL' using errcode = '22023';
  end if;

  v_label := coalesce(nullif(trim(coalesce(p_device_label, '')), ''), v_session.label);

  -- Resolve an existing canonical installation for the intended account, not
  -- just the session's own (always-NULL, wizard-created) field.
  v_installation_id := v_session.connector_installation_id;
  if v_installation_id is null and v_session.intended_account_id is not null then
    select fs.connector_installation_id into v_installation_id
    from public.accounts a
    join public.financial_sources fs on fs.id = a.financial_source_id
    where a.id = v_session.intended_account_id;
  end if;

  if v_installation_id is null then
    -- New installation: reuse the full legacy + canonical enrollment path.
    if v_session.intended_account_id is null then
      raise exception 'PAIRING_NO_ROUTE' using errcode = '22023';
    end if;

    v_connection_id := public._enroll_ingestion_connection(
      v_session.owner_user_id, v_session.home_workspace_id,
      v_session.intended_account_id, v_label, v_session.provider,
      p_new_credential_hash, p_new_credential_prefix
    );

    select ic.connector_installation_id, ic.device_credential_id
    into v_installation_id, v_credential_id
    from public.ingestion_connections ic
    where ic.id = v_connection_id;

    v_legacy_id := v_connection_id;
  else
    -- Existing installation: find the account's current canonical,
    -- legacy-mapped credential (there is at most one -
    -- device_credentials_legacy_connection_unique) and rotate it, exactly
    -- like rotate_device_credential does.
    select dc.id, dc.legacy_ingestion_connection_id
    into v_old_credential_id, v_legacy_id
    from public.device_credentials dc
    where dc.connector_installation_id = v_installation_id
      and dc.legacy_ingestion_connection_id is not null
      and dc.status = 'active'
    order by dc.created_at desc
    limit 1
    for update;

    v_account_id := coalesce(
      v_session.intended_account_id,
      (
        select dc.account_id from public.device_credentials dc
        where dc.connector_installation_id = v_installation_id
          and dc.status = 'active'
        order by dc.created_at asc
        limit 1
      )
    );

    if v_legacy_id is not null then
      -- Rotation: revoke the old canonical credential, releasing its legacy
      -- backlink, then mint a new one that inherits it.
      update public.device_credentials
      set status = 'revoked',
          revoked_at = v_now,
          paused_by_installation = false,
          legacy_ingestion_connection_id = null
      where id = v_old_credential_id;

      insert into public.device_credentials (
        connector_installation_id, account_id, label,
        credential_hash, credential_prefix, status,
        created_by, legacy_ingestion_connection_id, rotated_from_id
      ) values (
        v_installation_id, v_account_id, v_label,
        p_new_credential_hash, p_new_credential_prefix, 'active',
        v_session.owner_user_id, v_legacy_id, v_old_credential_id
      ) returning id into v_credential_id;

      -- Keep the legacy row's own auth path in sync (mirrors
      -- rotate_device_credential) and reactivate it - re-pairing is
      -- explicit, MFA-gated owner intent to make this connection live again.
      update public.ingestion_connections
      set credential_hash = p_new_credential_hash,
          credential_prefix = p_new_credential_prefix,
          device_credential_id = v_credential_id,
          status = 'active',
          revoked_at = null,
          paused_at = null
      where id = v_legacy_id;

      update public.connector_installations
      set status = 'healthy',
          revoked_at = null
      where id = v_installation_id
        and status <> 'paused';
    else
      -- No legacy-mapped credential exists to rotate (a canonical-only
      -- installation) - mint an additional credential. op:"capture"
      -- authentication for it depends on a future canonical-only cutover of
      -- resolve_canonical_ingestion_credential.
      insert into public.device_credentials (
        connector_installation_id, account_id, label,
        credential_hash, credential_prefix, status,
        created_by, legacy_ingestion_connection_id
      ) values (
        v_installation_id, v_account_id, v_label,
        p_new_credential_hash, p_new_credential_prefix, 'active',
        v_session.owner_user_id, null
      ) returning id into v_credential_id;
    end if;
  end if;

  update public.pairing_sessions
  set status = 'consumed',
      consumed_at = v_now,
      consumed_device_credential_id = v_credential_id,
      consumed_installation_id = v_installation_id
  where id = v_session.id;

  insert into public.connector_pairing_events (
    event, pairing_session_id, connector_installation_id, device_credential_id
  ) values (
    'device_paired', v_session.id, v_installation_id, v_credential_id
  );

  device_credential_id := v_credential_id;
  connector_installation_id := v_installation_id;
  legacy_ingestion_connection_id := v_legacy_id;
  return next;
end;
$function$;

comment on function public.consume_device_pairing_session(text, text, text, text, text, text) is
  'Service-role-only. Redeems a single-use pairing token for a scoped device credential. Re-pairing an account already linked to a connector_installation rotates its canonical credential (like rotate_device_credential) and reactivates the connection, instead of minting a second, unlinked credential that could never authenticate op:"capture".';
