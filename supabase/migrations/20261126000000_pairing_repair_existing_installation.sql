-- Fix device re-pairing (device pairing v2, ADR 0008). Root cause:
-- consume_device_pairing_session branches purely on
-- pairing_sessions.connector_installation_id - a field the pairing wizard
-- (web/app/integrations/connections/pair/actions.ts) never sets, so it is
-- always NULL. That meant EVERY pair attempt, not just the first, took the
-- "new installation" branch and called _enroll_ingestion_connection, which
-- inserts another public.ingestion_connections row and runs
-- backfill_legacy_ingestion_connection on it. For an account that was
-- already canonically enrolled (its financial_source already has a
-- connector_installation_id from an earlier successful pair),
-- connector_stage_b_preflight correctly refuses to double-map that
-- financial_source - it RAISEs, which rolls back the whole statement. That
-- raw Postgres exception isn't one of the typed pairing error codes, so the
-- capture Edge Function's extractPairingErrorCode falls back to the generic
-- "PAIRING_INVALID" - indistinguishable, from the client, from a genuinely
-- bad/expired code, even though the token was valid and unexpired.
--
-- Fix: before choosing a branch, also resolve any installation already
-- linked to the intended account's financial source (not just the session's
-- own field). Re-pairing an already-enrolled account then correctly takes
-- the existing "issue an additional scoped credential" branch (unchanged,
-- already used whenever a session's connector_installation_id IS set) instead
-- of re-running first-time enrollment. _enroll_ingestion_connection and
-- backfill_legacy_ingestion_connection are untouched - true first-time
-- enrollment (a fresh account, no financial_source, no installation) behaves
-- exactly as before.

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
  -- just the session's own (always-NULL, wizard-created) field. See the
  -- header comment: without this, re-pairing an already-enrolled account
  -- re-ran first-time enrollment and collided with the Stage B preflight.
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
    -- Existing installation (from the session, or resolved above from the
    -- intended account's already-linked financial source): issue an
    -- additional scoped credential.
    select ci.legacy_ingestion_connection_id
    into v_legacy_id
    from public.connector_installations ci
    where ci.id = v_installation_id
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

    -- device_credentials_legacy_connection_unique allows only one credential
    -- per legacy ingestion_connections row - the original one, already
    -- linked via ingestion_connections.device_credential_id. This
    -- additional credential has no legacy analog of its own.
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
  'Service-role-only. Redeems a single-use pairing token for a scoped device credential. Re-pairing an account already linked to a connector_installation mints an additional credential against it instead of re-running first-time enrollment.';
