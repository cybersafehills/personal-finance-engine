-- Auto-enroll a financial source when pairing a device (device pairing v2,
-- ADR 0008). Accounts created before the connector model (ADR 0007) carry
-- financial_source_id = NULL. create_device_pairing_session inner-joins
-- accounts -> financial_sources to check ownership, so for those accounts it
-- raised "The selected account is unavailable" and the wizard surfaced only a
-- generic "Could not start pairing" - a dead end unless the user first ran the
-- "Advanced connection" form (which calls _enroll_ingestion_connection).
--
-- This makes the first pairing self-sufficient: create_device_pairing_session
-- now guarantees the intended account has a canonical financial source
-- (created + linked, owned by the caller) before it records the session. No
-- legacy ingestion_connections row is written - only op:"capture" through the
-- paired device credential feeds the account.

-- ---------------------------------------------------------------------------
-- 1. _ensure_account_financial_source - internal, no role grant.
--    Mirrors the source-creation half of _enroll_ingestion_connection
--    (20261104000000) without the legacy ingestion_connections insert or the
--    Stage B backfill. Kept as a separate copy on purpose: the enrollment
--    path is proven and tested, and this must not perturb it.
-- ---------------------------------------------------------------------------
create or replace function public._ensure_account_financial_source(
  p_owner_user_id uuid,
  p_workspace_id uuid,
  p_account_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_financial_source_id uuid;
  v_source_owner uuid;
  v_account_name text;
  v_account_provider text;
  v_account_currency char(3);
begin
  if p_owner_user_id is null then
    raise exception 'Enrollment owner is required.' using errcode = '22023';
  end if;

  -- Lock the account row while resolving/creating its source so two
  -- concurrent callers cannot manufacture two canonical sources for it.
  select a.financial_source_id, fs.owner_user_id, a.name, a.provider, a.currency
  into v_financial_source_id, v_source_owner, v_account_name,
    v_account_provider, v_account_currency
  from public.accounts a
  left join public.financial_sources fs on fs.id = a.financial_source_id
  where a.id = p_account_id
    and a.workspace_id = p_workspace_id
    and a.is_active
    and a.archived_at is null
  for update of a;

  if not found then
    raise exception 'The selected account is unavailable.' using errcode = '22023';
  end if;

  if v_financial_source_id is null then
    insert into public.financial_sources (
      owner_user_id, provider, source_type, display_name, currency, created_by
    ) values (
      p_owner_user_id,
      v_account_provider,
      case v_account_provider
        when 'mtn_momo' then 'mobile_money'
        when 'airtel_money' then 'mobile_money'
        when 'bank' then 'bank_account'
        else 'import'
      end,
      v_account_name,
      v_account_currency,
      p_owner_user_id
    ) returning id into v_financial_source_id;

    update public.accounts
    set financial_source_id = v_financial_source_id
    where id = p_account_id;

    v_source_owner := p_owner_user_id;
  end if;

  if v_source_owner is distinct from p_owner_user_id then
    raise exception 'The financial source is owned by another user.'
      using errcode = '42501';
  end if;

  return v_financial_source_id;
end;
$$;

comment on function public._ensure_account_financial_source(uuid, uuid, uuid) is
  'Internal (security-definer callers only, no role grant). Idempotently guarantees an active account has a canonical financial_source owned by p_owner_user_id, creating + linking one for legacy NULL-source accounts. Mirrors the source-creation half of _enroll_ingestion_connection without a legacy ingestion_connections row.';
revoke all on function public._ensure_account_financial_source(uuid, uuid, uuid) from public;

-- ---------------------------------------------------------------------------
-- 2. create_device_pairing_session - re-created with the auto-enroll step.
--    Only the `p_intended_account_id is not null` block changes; everything
--    else is byte-for-byte the 20261104000000 body.
-- ---------------------------------------------------------------------------
create or replace function public.create_device_pairing_session(
  p_connector_key text,
  p_provider text,
  p_home_workspace_id uuid,
  p_label text,
  p_token_hash text,
  p_token_prefix text,
  p_intended_account_id uuid default null,
  p_connector_installation_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_session_id uuid;
  v_pending_count integer;
begin
  perform public.require_progressive_mfa();

  if p_connector_key is null or p_connector_key !~ '^[a-z][a-z0-9_]{2,63}$' then
    raise exception 'Connector key is invalid.' using errcode = '22023';
  end if;
  if p_provider is null or length(trim(p_provider)) = 0 then
    raise exception 'Provider is required.' using errcode = '22023';
  end if;
  if p_label is null or length(trim(p_label)) = 0 then
    raise exception 'A device label is required.' using errcode = '22023';
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Token hash must be a lowercase SHA-256 digest.' using errcode = '22023';
  end if;
  if p_token_prefix is null or p_token_prefix !~ '^olp_[A-Za-z0-9]{4}$' then
    raise exception 'Token prefix is invalid.' using errcode = '22023';
  end if;

  if not public.is_workspace_member(p_home_workspace_id, 'owner') then
    raise exception 'Only a workspace owner can pair a device.' using errcode = '42501';
  end if;

  if p_connector_installation_id is not null then
    if not exists (
      select 1 from public.connector_installations ci
      where ci.id = p_connector_installation_id
        and ci.owner_user_id = auth.uid()
        and ci.status <> 'revoked'
    ) then
      raise exception 'The connector installation is unavailable.' using errcode = '22023';
    end if;
  end if;

  if p_intended_account_id is not null then
    -- Guarantee the account has a canonical financial source before the
    -- ownership check below. Legacy accounts (financial_source_id = NULL)
    -- get one created + linked here, so a first-time pairing needs no
    -- separate "Advanced connection" step. Raises 'The selected account is
    -- unavailable.' / 'The financial source is owned by another user.' for
    -- an inactive/foreign account - both mapped to friendly copy by the
    -- caller (web/app/integrations/connections/pair/actions.ts).
    perform public._ensure_account_financial_source(
      auth.uid(), p_home_workspace_id, p_intended_account_id
    );

    if not exists (
      select 1
      from public.accounts a
      join public.financial_sources fs on fs.id = a.financial_source_id
      where a.id = p_intended_account_id
        and a.workspace_id = p_home_workspace_id
        and a.is_active
        and a.archived_at is null
        and fs.owner_user_id = auth.uid()
        and (
          p_connector_installation_id is null
          or fs.connector_installation_id = p_connector_installation_id
        )
    ) then
      raise exception 'The selected account is unavailable.' using errcode = '22023';
    end if;
  end if;

  -- Cap concurrent pending sessions per user; expire the oldest excess so a
  -- retry loop cannot accumulate live tokens.
  update public.pairing_sessions
  set status = 'expired'
  where owner_user_id = auth.uid()
    and status = 'pending'
    and id in (
      select id from public.pairing_sessions
      where owner_user_id = auth.uid() and status = 'pending'
      order by created_at desc
      offset 2
    );

  select count(*) into v_pending_count
  from public.pairing_sessions
  where owner_user_id = auth.uid() and status = 'pending';

  if v_pending_count >= 3 then
    raise exception 'Too many pending pairing sessions.' using errcode = '22023';
  end if;

  insert into public.pairing_sessions (
    owner_user_id, home_workspace_id, connector_key, provider,
    intended_account_id, connector_installation_id, label,
    token_hash, token_prefix, expires_at, created_by
  ) values (
    auth.uid(), p_home_workspace_id, p_connector_key, trim(p_provider),
    p_intended_account_id, p_connector_installation_id, trim(p_label),
    p_token_hash, p_token_prefix, v_now + interval '10 minutes', auth.uid()
  ) returning id into v_session_id;

  insert into public.connector_pairing_events (event, pairing_session_id)
  values ('device_pairing_started', v_session_id);

  return v_session_id;
end;
$$;

comment on function public.create_device_pairing_session(text, text, uuid, text, text, text, uuid, uuid) is
  'Authenticated, MFA-gated. Records a short-lived single-use pairing intent and auto-enrolls a canonical financial source for the intended account if it lacks one. The plaintext token is generated client-side and never reaches the database.';
revoke all on function public.create_device_pairing_session(text, text, uuid, text, text, text, uuid, uuid) from public;
grant execute on function public.create_device_pairing_session(text, text, uuid, text, text, text, uuid, uuid) to authenticated;
