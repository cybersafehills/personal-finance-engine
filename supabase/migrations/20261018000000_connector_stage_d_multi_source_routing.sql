-- Connector model Stage D: provider-neutral multi-source discovery and
-- deterministic event routing. This is an additive, service-only foundation;
-- no current adapter calls these RPCs and ingest-momo remains unchanged.

-- Align account projections with the provider vocabulary financial_sources
-- already accepts. This only expands valid values; all existing rows remain
-- valid and current account behavior is unchanged.
alter table public.accounts drop constraint accounts_provider_check;
alter table public.accounts add constraint accounts_provider_check
  check (provider in (
    'mtn_momo', 'airtel_money', 'bank', 'card', 'cash', 'statement', 'other'
  ));

alter table public.accounts
  add column external_account_ref_hash text;

comment on column public.accounts.external_account_ref_hash is
  'Hash of a provider-stable account/sub-ledger reference, scoped to one financial source and workspace. Masked display identifiers are never routing identity.';

create unique index accounts_source_workspace_external_ref_unique
  on public.accounts (
    financial_source_id,
    workspace_id,
    external_account_ref_hash
  )
  where financial_source_id is not null
    and external_account_ref_hash is not null;

create or replace function public.apply_connector_discovery(
  p_connector_installation_id uuid,
  p_sources jsonb
)
returns table (
  financial_source_id uuid,
  account_id uuid,
  source_ref_hash text,
  account_ref_hash text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_user_id uuid;
  v_home_workspace_id uuid;
  v_source jsonb;
  v_account jsonb;
  v_accounts jsonb;
  v_source_id uuid;
  v_account_id uuid;
  v_source_ref text;
  v_account_ref text;
  v_provider_key text;
  v_provider text;
  v_source_type text;
  v_source_name text;
  v_account_name text;
  v_masked_identifier text;
  v_source_currency text;
  v_account_currency text;
  v_existing_provider_key text;
  v_existing_provider text;
  v_existing_source_type text;
  v_existing_currency text;
begin
  if jsonb_typeof(p_sources) <> 'array'
    or jsonb_array_length(p_sources) < 1
    or jsonb_array_length(p_sources) > 100 then
    raise exception 'discovery_sources_invalid' using errcode = '22023';
  end if;

  select ci.owner_user_id, ci.home_workspace_id
  into v_owner_user_id, v_home_workspace_id
  from public.connector_installations ci
  where ci.id = p_connector_installation_id
    and ci.status not in ('paused', 'revoked')
  for update;

  if not found then
    raise exception 'connector_installation_unavailable' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_sources) item
    group by item ->> 'source_ref_hash'
    having count(*) > 1
  ) then
    raise exception 'duplicate_source_discriminator' using errcode = '22023';
  end if;

  for v_source in select value from jsonb_array_elements(p_sources)
  loop
    if jsonb_typeof(v_source) <> 'object'
      or exists (
        select 1 from jsonb_object_keys(v_source) as key_name
        where key_name not in (
          'source_ref_hash', 'provider_key', 'provider', 'source_type',
          'display_name', 'masked_identifier', 'currency', 'accounts'
        )
      ) then
      raise exception 'discovery_source_shape_invalid' using errcode = '22023';
    end if;

    v_source_ref := v_source ->> 'source_ref_hash';
    v_provider_key := v_source ->> 'provider_key';
    v_provider := v_source ->> 'provider';
    v_source_type := v_source ->> 'source_type';
    v_source_name := btrim(v_source ->> 'display_name');
    v_masked_identifier := nullif(btrim(v_source ->> 'masked_identifier'), '');
    v_source_currency := upper(v_source ->> 'currency');
    v_accounts := v_source -> 'accounts';

    if v_source_ref is null or v_source_ref !~ '^[0-9a-f]{64}$'
      or v_provider_key is null
      or v_provider_key !~ '^[a-z][a-z0-9_]{1,63}$'
      or v_provider is null
      or v_source_type is null
      or v_source_name is null or v_source_name = ''
      or length(v_source_name) > 120
      or v_source_currency is null
      or v_source_currency !~ '^[A-Z]{3}$'
      or (v_masked_identifier is not null and (
        length(v_masked_identifier) > 64
        or length(regexp_replace(v_masked_identifier, '[^0-9]', '', 'g')) > 4
      ))
      or jsonb_typeof(v_accounts) <> 'array'
      or jsonb_array_length(v_accounts) < 1
      or jsonb_array_length(v_accounts) > 100 then
      raise exception 'discovery_source_values_invalid' using errcode = '22023';
    end if;

    if exists (
      select 1
      from jsonb_array_elements(v_accounts) item
      group by item ->> 'account_ref_hash'
      having count(*) > 1
    ) then
      raise exception 'duplicate_account_discriminator' using errcode = '22023';
    end if;

    select fs.id, fs.provider_key, fs.provider, fs.source_type, fs.currency
    into v_source_id, v_existing_provider_key, v_existing_provider,
      v_existing_source_type, v_existing_currency
    from public.financial_sources fs
    where fs.connector_installation_id = p_connector_installation_id
      and fs.external_source_ref_hash = v_source_ref
    for update;

    if found then
      if v_existing_provider_key is distinct from v_provider_key
        or v_existing_provider is distinct from v_provider
        or v_existing_source_type is distinct from v_source_type
        or v_existing_currency is distinct from v_source_currency then
        raise exception 'discovery_source_identity_changed' using errcode = '22023';
      end if;

      update public.financial_sources
      set display_name = v_source_name,
          masked_identifier = v_masked_identifier
      where id = v_source_id;
    else
      insert into public.financial_sources (
        owner_user_id,
        connector_installation_id,
        provider,
        provider_key,
        source_type,
        display_name,
        masked_identifier,
        currency,
        external_source_ref_hash,
        created_by
      ) values (
        v_owner_user_id,
        p_connector_installation_id,
        v_provider,
        v_provider_key,
        v_source_type,
        v_source_name,
        v_masked_identifier,
        v_source_currency,
        v_source_ref,
        v_owner_user_id
      ) returning id into v_source_id;
    end if;

    for v_account in select value from jsonb_array_elements(v_accounts)
    loop
      if jsonb_typeof(v_account) <> 'object'
        or exists (
          select 1 from jsonb_object_keys(v_account) as key_name
          where key_name not in (
            'account_ref_hash', 'display_name', 'provider', 'currency'
          )
        ) then
        raise exception 'discovery_account_shape_invalid' using errcode = '22023';
      end if;

      v_account_ref := v_account ->> 'account_ref_hash';
      v_account_name := btrim(v_account ->> 'display_name');
      v_account_currency := upper(v_account ->> 'currency');

      if v_account_ref is null or v_account_ref !~ '^[0-9a-f]{64}$'
        or v_account_name is null or v_account_name = ''
        or length(v_account_name) > 120
        or (v_account ->> 'provider') is null
        or v_account_currency is null
        or v_account_currency !~ '^[A-Z]{3}$' then
        raise exception 'discovery_account_values_invalid' using errcode = '22023';
      end if;

      select a.id, a.provider, a.currency
      into v_account_id, v_existing_provider, v_existing_currency
      from public.accounts a
      where a.financial_source_id = v_source_id
        and a.workspace_id = v_home_workspace_id
        and a.external_account_ref_hash = v_account_ref
      for update;

      if found then
        if v_existing_provider is distinct from (v_account ->> 'provider')
          or v_existing_currency is distinct from v_account_currency then
          raise exception 'discovery_account_identity_changed' using errcode = '22023';
        end if;

        update public.accounts
        set name = v_account_name
        where id = v_account_id;
      else
        insert into public.accounts (
          workspace_id,
          financial_source_id,
          name,
          provider,
          currency,
          external_account_ref_hash
        ) values (
          v_home_workspace_id,
          v_source_id,
          v_account_name,
          v_account ->> 'provider',
          v_account_currency,
          v_account_ref
        ) returning id into v_account_id;
      end if;

      financial_source_id := v_source_id;
      account_id := v_account_id;
      source_ref_hash := v_source_ref;
      account_ref_hash := v_account_ref;
      return next;
    end loop;
  end loop;
end;
$$;

comment on function public.apply_connector_discovery(uuid, jsonb) is
  'Service-only idempotent materialization of validated, hash-identified sources/accounts in an installation home workspace. Unknown fields and identity changes fail closed.';
revoke all on function public.apply_connector_discovery(uuid, jsonb) from public;
grant execute on function public.apply_connector_discovery(uuid, jsonb) to service_role;

create or replace function public.resolve_connector_event_route(
  p_device_credential_id uuid,
  p_source_ref_hash text default null,
  p_account_ref_hash text default null
)
returns table (
  connector_installation_id uuid,
  device_credential_id uuid,
  financial_source_id uuid,
  account_id uuid,
  workspace_id uuid
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_installation_id uuid;
  v_scoped_account_id uuid;
  v_home_workspace_id uuid;
  v_source_id uuid;
  v_account_id uuid;
  v_workspace_id uuid;
  v_source_hash text;
  v_account_hash text;
  v_candidate_count bigint;
begin
  if p_source_ref_hash is not null
    and p_source_ref_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'source_discriminator_invalid' using errcode = '22023';
  end if;
  if p_account_ref_hash is not null
    and p_account_ref_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'account_discriminator_invalid' using errcode = '22023';
  end if;

  select dc.connector_installation_id, dc.account_id, ci.home_workspace_id
  into v_installation_id, v_scoped_account_id, v_home_workspace_id
  from public.device_credentials dc
  join public.connector_installations ci
    on ci.id = dc.connector_installation_id
  where dc.id = p_device_credential_id
    and dc.status = 'active'
    and (dc.expires_at is null or dc.expires_at > statement_timestamp())
    and ci.status not in ('paused', 'revoked');

  if not found then
    return;
  end if;

  if v_scoped_account_id is not null then
    select fs.id, a.id, a.workspace_id, fs.external_source_ref_hash,
      a.external_account_ref_hash
    into v_source_id, v_account_id, v_workspace_id, v_source_hash,
      v_account_hash
    from public.accounts a
    join public.financial_sources fs on fs.id = a.financial_source_id
    where a.id = v_scoped_account_id
      and a.is_active
      and a.archived_at is null
      and fs.status = 'active'
      and fs.connector_installation_id = v_installation_id;

    if not found then
      raise exception 'credential_account_scope_unavailable' using errcode = '22023';
    end if;
    if p_source_ref_hash is not null
      and p_source_ref_hash is distinct from v_source_hash then
      raise exception 'credential_source_discriminator_mismatch' using errcode = '22023';
    end if;
    if p_account_ref_hash is not null
      and p_account_ref_hash is distinct from v_account_hash then
      raise exception 'credential_account_discriminator_mismatch' using errcode = '22023';
    end if;
  else
    if p_source_ref_hash is not null then
      select fs.id into v_source_id
      from public.financial_sources fs
      where fs.connector_installation_id = v_installation_id
        and fs.external_source_ref_hash = p_source_ref_hash
        and fs.status = 'active';
      if not found then
        raise exception 'source_discriminator_not_found' using errcode = '22023';
      end if;
    else
      select count(*), (array_agg(fs.id order by fs.id))[1]
      into v_candidate_count, v_source_id
      from public.financial_sources fs
      where fs.connector_installation_id = v_installation_id
        and fs.status = 'active';
      if v_candidate_count = 0 then
        raise exception 'connector_source_unavailable' using errcode = '22023';
      elsif v_candidate_count > 1 then
        raise exception 'source_discriminator_required' using errcode = '22023';
      end if;
    end if;

    if p_account_ref_hash is not null then
      select a.id, a.workspace_id into v_account_id, v_workspace_id
      from public.accounts a
      where a.financial_source_id = v_source_id
        and a.workspace_id = v_home_workspace_id
        and a.external_account_ref_hash = p_account_ref_hash
        and a.is_active
        and a.archived_at is null;
      if not found then
        raise exception 'account_discriminator_not_found' using errcode = '22023';
      end if;
    else
      select count(*),
        (array_agg(a.id order by a.id))[1],
        (array_agg(a.workspace_id order by a.id))[1]
      into v_candidate_count, v_account_id, v_workspace_id
      from public.accounts a
      where a.financial_source_id = v_source_id
        and a.workspace_id = v_home_workspace_id
        and a.is_active
        and a.archived_at is null;
      if v_candidate_count = 0 then
        raise exception 'connector_account_unavailable' using errcode = '22023';
      elsif v_candidate_count > 1 then
        raise exception 'account_discriminator_required' using errcode = '22023';
      end if;
    end if;
  end if;

  return query select
    v_installation_id,
    p_device_credential_id,
    v_source_id,
    v_account_id,
    v_workspace_id;
end;
$$;

comment on function public.resolve_connector_event_route(uuid, text, text) is
  'Service-only deterministic installation/source/account resolver. Scoped credentials win; unscoped credentials require stable hash discriminators whenever more than one active route exists.';
revoke all on function public.resolve_connector_event_route(uuid, text, text) from public;
grant execute on function public.resolve_connector_event_route(uuid, text, text) to service_role;
