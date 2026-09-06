-- Account erasure (ADR 0016 §3, audit F12). The irreversible half of the
-- account-deletion workstream: a cron drains scheduled deletion requests
-- past their 30-day grace window and calls execute_account_deletion(),
-- which removes the user's Personal Space and everything in it, their
-- owned financial sources and connectors, nulls their attribution
-- references in shared Spaces, and deletes the auth.users row.
--
-- Ships dark: the cron (app/api/cron/process-account-deletions) is a
-- no-op unless ACCOUNT_DELETION_EXECUTE_ENABLED=true. execute_account_
-- deletion itself is service_role-only and never wired to a user action.
--
-- The FK graph this function navigates was captured from the real built
-- schema on 2026-09-06 (probe in the PR). Deleting a `workspaces` row
-- cascades 46 of its 58 inbound FKs already; five tenant-scoped tables
-- were left ON DELETE NO ACTION by older migrations and are converted to
-- CASCADE below so the Personal-Space teardown is a single statement.
-- The remaining blockers (connector_installations / pairing_sessions /
-- device_credentials / momo_messages / raw_financial_events, all with
-- deliberate RESTRICT edges) are dismantled explicitly in the function.

-- 1. Bring five tenant-scoped tables onto the ON DELETE CASCADE
--    convention every other workspace-scoped table already uses.
alter table public.accounts
  drop constraint accounts_workspace_id_fkey,
  add constraint accounts_workspace_id_fkey
    foreign key (workspace_id) references public.workspaces (id)
    on delete cascade;

alter table public.categorization_policies
  drop constraint merchant_rules_workspace_id_fkey,
  add constraint merchant_rules_workspace_id_fkey
    foreign key (workspace_id) references public.workspaces (id)
    on delete cascade;

alter table public.transactions
  drop constraint transactions_workspace_id_fkey,
  add constraint transactions_workspace_id_fkey
    foreign key (workspace_id) references public.workspaces (id)
    on delete cascade;

alter table public.transaction_category_history
  drop constraint transaction_category_history_workspace_id_fkey,
  add constraint transaction_category_history_workspace_id_fkey
    foreign key (workspace_id) references public.workspaces (id)
    on delete cascade;

alter table public.learned_policy_suggestion_decisions
  drop constraint learned_policy_suggestion_decisions_workspace_id_fkey,
  add constraint learned_policy_suggestion_decisions_workspace_id_fkey
    foreign key (workspace_id) references public.workspaces (id)
    on delete cascade;

-- 2. Durable audit trail. No FK to auth.users (that row is gone by the
--    time we write here), so the record survives the erasure.
create table public.account_deletion_log (
  id uuid primary key default extensions.gen_random_uuid(),
  deleted_user_id uuid not null,
  requested_at timestamptz,
  scheduled_for timestamptz,
  completed_at timestamptz not null default now(),
  reason text,
  workspaces_removed int not null default 0
);

comment on table public.account_deletion_log is
  'One row per completed account erasure (execute_account_deletion). No FK to auth.users - it must outlive the deleted row. Service-role only.';

alter table public.account_deletion_log enable row level security;
-- No policy: authenticated/anon get nothing; service_role bypasses RLS.
grant select, insert on public.account_deletion_log to service_role;

-- 3. The cron's work queue: scheduled requests whose grace window has
--    closed. Service-role only.
create or replace function public.pending_account_deletions(p_limit int default 50)
  returns setof uuid
  language sql
  security definer
  set search_path = public
as $$
  select user_id
  from public.account_deletion_requests
  where status = 'scheduled'
    and scheduled_for <= now()
  order by scheduled_for
  limit greatest(1, least(coalesce(p_limit, 50), 500));
$$;

revoke all on function public.pending_account_deletions(int) from public;
grant execute on function public.pending_account_deletions(int) to service_role;

-- 4. Extend the request guard: you also cannot schedule deletion while an
--    account you own is still shared into a Space that has other active
--    members - erasing it would pull data out from under them. Un-share
--    first. (A source shared only into your own solo Spaces is fine.)
create or replace function public.request_account_deletion(
  p_reason text default null
)
  returns public.account_deletion_requests
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_blocking int;
  v_row public.account_deletion_requests;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  -- Sole owner of a shared Space with other active members.
  select count(*)
    into v_blocking
  from public.workspaces w
  where w.kind <> 'personal'
    and exists (
      select 1 from public.workspace_memberships m
      where m.workspace_id = w.id
        and m.user_id = v_uid
        and m.role = 'owner'
        and m.status = 'active'
    )
    and (
      select count(*) from public.workspace_memberships m2
      where m2.workspace_id = w.id and m2.status = 'active'
    ) > 1
    and (
      select count(*) from public.workspace_memberships m3
      where m3.workspace_id = w.id
        and m3.role = 'owner'
        and m3.status = 'active'
    ) = 1;

  if v_blocking > 0 then
    raise exception
      'Transfer ownership or remove the other members of your shared Spaces before deleting your account'
      using errcode = 'P0001';
  end if;

  -- An owned source still shared into a Space that has other active
  -- members.
  select count(*)
    into v_blocking
  from public.source_space_links l
  join public.financial_sources s on s.id = l.financial_source_id
  where s.owner_user_id = v_uid
    and l.status in ('active', 'paused')
    and (
      select count(*) from public.workspace_memberships m
      where m.workspace_id = l.workspace_id
        and m.status = 'active'
        and m.user_id <> v_uid
    ) > 0;

  if v_blocking > 0 then
    raise exception
      'Stop sharing your accounts with your shared Spaces before deleting your account'
      using errcode = 'P0004';
  end if;

  insert into public.account_deletion_requests (user_id, reason, scheduled_for)
  values (v_uid, nullif(btrim(p_reason), ''), now() + interval '30 days')
  on conflict (user_id) do update
    set status = 'scheduled',
        reason = excluded.reason,
        requested_at = now(),
        scheduled_for = now() + interval '30 days',
        cancelled_at = null,
        completed_at = null
  returning * into v_row;

  return v_row;
end;
$$;

-- 5. The erasure itself. Service-role only; invoked by the cron for each
--    id from pending_account_deletions().
create or replace function public.execute_account_deletion(p_user_id uuid)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_req public.account_deletion_requests%rowtype;
  v_solo_ws uuid[];
  v_ws uuid;
  v_removed int := 0;
  v_col record;
begin
  if p_user_id is null then
    raise exception 'p_user_id required' using errcode = '22004';
  end if;

  select * into v_req
  from public.account_deletion_requests
  where user_id = p_user_id;

  -- Re-check the same guards the request enforced - state may have
  -- changed during the grace window.
  if exists (
    select 1 from public.workspaces w
    where w.kind <> 'personal'
      and exists (
        select 1 from public.workspace_memberships m
        where m.workspace_id = w.id and m.user_id = p_user_id
          and m.role = 'owner' and m.status = 'active'
      )
      and (select count(*) from public.workspace_memberships m2
           where m2.workspace_id = w.id and m2.status = 'active') > 1
  ) then
    raise exception 'account % still solely owns a populated shared Space', p_user_id
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.source_space_links l
    join public.financial_sources s on s.id = l.financial_source_id
    where s.owner_user_id = p_user_id
      and l.status in ('active', 'paused')
      and exists (
        select 1 from public.workspace_memberships m
        where m.workspace_id = l.workspace_id and m.status = 'active'
          and m.user_id <> p_user_id
      )
  ) then
    raise exception 'account % still shares a source into a populated Space', p_user_id
      using errcode = 'P0004';
  end if;

  -- Workspaces whose only active member is this user (their Personal
  -- Space always; any solo household / organization too).
  select coalesce(array_agg(w.id), '{}')
    into v_solo_ws
  from public.workspaces w
  where not exists (
    select 1 from public.workspace_memberships m
    where m.workspace_id = w.id
      and m.status = 'active'
      and m.user_id <> p_user_id
  )
  and exists (
    select 1 from public.workspace_memberships m
    where m.workspace_id = w.id and m.user_id = p_user_id
  );

  foreach v_ws in array v_solo_ws loop
    -- The teardown order matters: RESTRICT edges are checked immediately
    -- (not at statement end), so a plain `delete from workspaces` cannot
    -- unwind the transaction / momo_messages / ingestion / connector
    -- chain on its own. Dismantle it bottom-up, then let the workspace
    -- delete cascade the ~46 remaining CASCADE children.

    -- Raw evidence tied to this Space's connections / sources / txns.
    delete from public.raw_financial_events
    where ingestion_connection_id in (
            select id from public.ingestion_connections where workspace_id = v_ws)
       or connector_installation_id in (
            select id from public.connector_installations where home_workspace_id = v_ws)
       or financial_source_id in (
            select id from public.financial_sources where owner_user_id = p_user_id)
       or canonical_transaction_id in (
            select id from public.transactions where workspace_id = v_ws)
       or device_credential_id in (
            select dc.id from public.device_credentials dc
            where dc.connector_installation_id in (
                    select id from public.connector_installations where home_workspace_id = v_ws)
               or dc.account_id in (
                    select id from public.accounts where workspace_id = v_ws));

    -- Transaction-graph rows that are NO ACTION (no CASCADE sibling) and
    -- would block deleting the transactions themselves.
    delete from public.transaction_category_history where workspace_id = v_ws;
    delete from public.transfer_links where workspace_id = v_ws;
    update public.goal_contributions set transaction_id = null
    where transaction_id in (select id from public.transactions where workspace_id = v_ws);

    -- Transactions. The single-column *_transaction_id_fkey CASCADEs pick
    -- up splits / attributions / bill links / reconciliations.
    delete from public.transactions where workspace_id = v_ws;

    -- momo_messages was RESTRICT-referenced by those transactions; now free.
    delete from public.momo_messages
    where ingestion_connection_id in (
      select id from public.ingestion_connections where workspace_id = v_ws);

    -- Connector / device chain (all RESTRICT), self-ref first.
    update public.device_credentials set rotated_from_id = null
    where connector_installation_id in (
            select id from public.connector_installations where home_workspace_id = v_ws)
       or account_id in (select id from public.accounts where workspace_id = v_ws);

    delete from public.pairing_sessions
    where home_workspace_id = v_ws
       or intended_account_id in (select id from public.accounts where workspace_id = v_ws)
       or connector_installation_id in (
            select id from public.connector_installations where home_workspace_id = v_ws);

    delete from public.device_credentials
    where connector_installation_id in (
            select id from public.connector_installations where home_workspace_id = v_ws)
       or account_id in (select id from public.accounts where workspace_id = v_ws)
       or legacy_ingestion_connection_id in (
            select id from public.ingestion_connections where workspace_id = v_ws);

    update public.financial_sources set connector_installation_id = null
    where connector_installation_id in (
      select id from public.connector_installations where home_workspace_id = v_ws);

    delete from public.ingestion_connections where workspace_id = v_ws;
    delete from public.connector_installations where home_workspace_id = v_ws;

    delete from public.workspaces where id = v_ws;  -- cascades the rest
    v_removed := v_removed + 1;
  end loop;

  -- The user's own sources / connectors (now unblocked: every account,
  -- transaction, rule and raw event that referenced them lived in a solo
  -- workspace just deleted).
  delete from public.financial_sources where owner_user_id = p_user_id;
  delete from public.pairing_sessions where owner_user_id = p_user_id;
  delete from public.connector_installations where owner_user_id = p_user_id;

  -- Neutralise every remaining NO ACTION / RESTRICT auth.users reference
  -- (the "who did this" attribution columns in Spaces the user only
  -- participated in, plus operator/canary tooling). Discovered from the
  -- catalogue so a column added later is handled automatically: a
  -- nullable column is nulled (the row - a shared-ledger fact - stays,
  -- the actor becomes "a former member"); a NOT NULL column means the row
  -- has no meaning without its user, so the row is deleted.
  for v_col in
    select c.conrelid::regclass::text as tbl,
           (select a.attname from pg_attribute a
            where a.attrelid = c.conrelid and a.attnum = c.conkey[1]) as col,
           (select a.attnotnull from pg_attribute a
            where a.attrelid = c.conrelid and a.attnum = c.conkey[1]) as notnull
    from pg_constraint c
    where c.contype = 'f'
      and c.confrelid = 'auth.users'::regclass
      and c.confdeltype in ('a', 'r')
      and array_length(c.conkey, 1) = 1
  loop
    if v_col.notnull then
      execute format(
        'delete from public.%I where %I = $1', v_col.tbl, v_col.col
      ) using p_user_id;
    else
      execute format(
        'update public.%I set %I = null where %I = $1',
        v_col.tbl, v_col.col, v_col.col
      ) using p_user_id;
    end if;
  end loop;

  insert into public.account_deletion_log
    (deleted_user_id, requested_at, scheduled_for, reason, workspaces_removed)
  values
    (p_user_id, v_req.requested_at, v_req.scheduled_for, v_req.reason, v_removed);

  -- Cascades profiles, memberships in others' Spaces, notifications,
  -- ui_preferences, report_*, attributions, capability grants, goal
  -- participation, directory / service rows.
  delete from auth.users where id = p_user_id;
end;
$$;

comment on function public.execute_account_deletion is
  'Irreversible account erasure (ADR 0016 §3). Service-role only, invoked by the process-account-deletions cron. Deletes the user''s solo workspaces + owned sources/connectors, nulls their attribution refs in shared Spaces, writes account_deletion_log, deletes auth.users. Re-checks the request guards.';

revoke all on function public.execute_account_deletion(uuid) from public;
grant execute on function public.execute_account_deletion(uuid) to service_role;
