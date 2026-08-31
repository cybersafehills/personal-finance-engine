-- Connector Stage B production preflight repair.
--
-- The first production Stage B attempt correctly failed closed on:
--   * one unused duplicate legacy connection sharing an account/source with
--     the live connection; and
--   * one personal-workspace account created without a financial source.
--
-- This migration is intentionally target-specific and fail-closed. It is a
-- no-op on fresh environments. On production it deletes the approved unused
-- duplicate only after rechecking that it has no ingestion provenance, and it
-- creates the missing source only when the workspace still has exactly one
-- active owner. Any drift aborts the whole transaction.

do $$
declare
  v_live_connection constant uuid := '4a4c733d-5708-4269-9b6d-95ae00d5abe8';
  v_unused_connection constant uuid := 'aab2c222-9d77-43bc-9b7d-7cb2d5bd3397';
  v_shared_workspace constant uuid := '585655e8-18bd-43da-8a6d-594b037b37a6';
  v_shared_account constant uuid := '347abae9-5bc9-43ea-883c-e51165053b52';
  v_shared_source constant uuid := '5c244452-2d6a-4f87-a589-c62eb713ad3b';

  v_missing_source_connection constant uuid := '07b399ac-4e7e-464d-b51d-15b0d9e90c74';
  v_missing_source_workspace constant uuid := '3422fd5e-42eb-4024-90bf-eb21ce3a9491';
  v_missing_source_account constant uuid := 'a6f0c544-282f-4406-bd7a-3dba0bc40add';

  v_unused public.ingestion_connections%rowtype;
  v_live public.ingestion_connections%rowtype;
  v_missing public.ingestion_connections%rowtype;
  v_account public.accounts%rowtype;
  v_workspace public.workspaces%rowtype;
  v_source_owner uuid;
  v_owner uuid;
  v_owner_count bigint;
  v_reference_count bigint;
  v_live_evidence_count bigint;
  v_rows bigint;
  v_new_source uuid;
begin
  -- Serialize this preparation with the Stage B backfill that follows it.
  perform pg_advisory_xact_lock(hashtext('oneledger.connector_stage_b'));

  select * into v_unused
  from public.ingestion_connections
  where id = v_unused_connection
  for update;

  if found then
    select * into strict v_live
    from public.ingestion_connections
    where id = v_live_connection
    for update;

    if v_unused.workspace_id <> v_shared_workspace
       or v_unused.account_id <> v_shared_account
       or v_unused.status <> 'active'
       or v_unused.last_used_at is not null
       or v_live.workspace_id <> v_shared_workspace
       or v_live.account_id <> v_shared_account
       or v_live.status <> 'active' then
      raise exception 'Stage B repair refused: duplicate/live connection identity or lifecycle drifted';
    end if;

    if (select a.financial_source_id from public.accounts a where a.id = v_unused.account_id)
         is distinct from v_shared_source
       or (select a.financial_source_id from public.accounts a where a.id = v_live.account_id)
         is distinct from v_shared_source then
      raise exception 'Stage B repair refused: duplicate/live connection source drifted';
    end if;

    select
      (select count(*) from public.transactions t
        where t.ingestion_connection_id = v_unused_connection)
      + (select count(*) from public.momo_messages m
        where m.ingestion_connection_id = v_unused_connection)
      + (select count(*) from public.raw_financial_events r
        where r.ingestion_connection_id = v_unused_connection)
    into v_reference_count;

    if v_reference_count <> 0 then
      raise exception 'Stage B repair refused: approved duplicate now has % provenance rows',
        v_reference_count;
    end if;

    select
      (select count(*) from public.transactions t
        where t.ingestion_connection_id = v_live_connection)
      + (select count(*) from public.momo_messages m
        where m.ingestion_connection_id = v_live_connection)
      + (select count(*) from public.raw_financial_events r
        where r.ingestion_connection_id = v_live_connection)
    into v_live_evidence_count;

    if v_live_evidence_count = 0 then
      raise exception 'Stage B repair refused: designated live connection has no provenance';
    end if;

    delete from public.ingestion_connections
    where id = v_unused_connection
      and last_used_at is null;
    get diagnostics v_rows = row_count;

    if v_rows <> 1 then
      raise exception 'Stage B repair refused: unused duplicate delete affected % rows', v_rows;
    end if;
  end if;

  select * into v_missing
  from public.ingestion_connections
  where id = v_missing_source_connection
  for update;

  if found then
    select * into strict v_account
    from public.accounts
    where id = v_missing_source_account
    for update;

    select * into strict v_workspace
    from public.workspaces
    where id = v_missing_source_workspace
    for update;

    if v_missing.workspace_id <> v_missing_source_workspace
       or v_missing.account_id <> v_missing_source_account
       or v_missing.status <> 'active'
       or v_account.workspace_id <> v_missing_source_workspace
       or v_workspace.kind <> 'personal'
       or v_account.provider <> 'mtn_momo' then
      raise exception 'Stage B repair refused: missing-source connection/account identity drifted';
    end if;

    select count(*), (array_agg(wm.user_id order by wm.user_id))[1]
      into v_owner_count, v_owner
    from public.workspace_memberships wm
    where wm.workspace_id = v_missing_source_workspace
      and wm.role = 'owner'
      and wm.status = 'active';

    if v_owner_count <> 1 or v_owner is null then
      raise exception 'Stage B repair refused: personal workspace has % active owners',
        v_owner_count;
    end if;

    if v_account.financial_source_id is null then
      insert into public.financial_sources (
        owner_user_id,
        provider,
        source_type,
        display_name,
        currency,
        visibility_mode,
        status,
        created_by,
        created_at
      ) values (
        v_owner,
        'mtn_momo',
        'mobile_money',
        v_account.name,
        v_account.currency,
        'personal_only',
        'active',
        coalesce(v_missing.created_by, v_owner),
        v_account.created_at
      ) returning id into v_new_source;

      update public.accounts
      set financial_source_id = v_new_source
      where id = v_missing_source_account
        and financial_source_id is null;
      get diagnostics v_rows = row_count;

      if v_rows <> 1 then
        raise exception 'Stage B repair refused: missing-source link affected % accounts',
          v_rows;
      end if;
    else
      select fs.owner_user_id into strict v_source_owner
      from public.financial_sources fs
      where fs.id = v_account.financial_source_id;

      if v_source_owner <> v_owner then
        raise exception 'Stage B repair refused: existing source owner differs from workspace owner';
      end if;
    end if;
  end if;
end $$;
