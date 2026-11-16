-- Two-tenant isolation sweep. Run by run_migration_tests.sh against a freshly
-- migrated disposable database (never anything else).
--
-- WHY THIS EXISTS: run_migration_tests.sh already proves isolation feature by
-- feature (one hand-written case per table or RPC). That cannot notice a table
-- added NEXT month with a missing policy, or one whose policy was loosened. This
-- file is the net underneath those tests: it discovers the tables from the
-- catalog, so a new workspace-scoped table is covered automatically.
--
--   Layer 1 (structural, no data): RLS is on wherever a client role can reach a
--     table; anon has no table or function access beyond the one intended public
--     function; no policy hands every row to everybody except the known
--     reference tables.
--   Layer 2 (behavioural, seeded): one row is planted in tenant A for every
--     workspace-scoped table a signed-in user can read. Then, as tenant B (a
--     member of a different workspace only): B reads zero of A's rows; B cannot
--     insert a row into A's workspace; B's UPDATE and DELETE touch zero of A's
--     rows. For every negative there is a positive control: tenant A DOES see
--     its own row, so "B saw nothing" cannot be a symptom of an empty table.
--
-- Output: one "PASS|..." or "FAIL|..." line per assertion on stdout (the shell
-- harness counts them). Fail-closed: a table the generator cannot seed, or a
-- probe that errors for a reason other than a permission denial, is a FAIL, not
-- a skip, unless it is named in the explicit allowlists below.
--
-- NOT COVERED (state this wherever the suite is cited): service-role code in
-- the Edge Functions and web server routes bypasses RLS by design and is
-- tested separately. Tables keyed by user_id or account_id with no workspace_id
-- column are NOT covered by this sweep. Invite recipient-binding is not covered.
-- Source visibility (Phase Q) and cross-tenant raw-event dedupe (Phase 0, F2)
-- have their own sections in run_migration_tests.sh.

\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned
\pset fieldsep '|'

create schema tt;
create table tt.results (ord serial primary key, status text not null, msg text not null);

create function tt.rec(p_ok boolean, p_msg text) returns void language sql as $$
  insert into tt.results (status, msg) values (case when p_ok then 'PASS' else 'FAIL' end, p_msg);
$$;

-- Known, deliberate exceptions. Adding to these lists is a security decision:
-- say why in review.
create table tt.allow (kind text not null, name text not null, why text not null);
insert into tt.allow values
  ('rls_off',        'auth_login_attempts',    'login lockout counters; service-role only, no client grants (asserted below)'),
  ('open_select',    'regulatory_authorities', 'public reference data, SELECT only'),
  ('open_select',    'service_operators',      'public reference data, SELECT only'),
  ('forge_gap',      'directory_suggestions',  'KNOWN GAP: insert policy checks only suggester_user_id = auth.uid(), so a user can stamp a suggestion with another tenant''s workspace_id (provenance only; the row is readable just by its author and directory admins). Fix with a forward migration adding is_workspace_member(workspace_id) to WITH CHECK, then delete this row.'),
  ('anon_function',  'invite_preview',         'invite landing page, takes an unguessable token hash and returns a redacted preview');

-- Per-table column values the generic row builder cannot infer from types and
-- CHECK constraints (format regexes, exactly-one-of-N targets, cross-column
-- rules). A value is a SQL expression.
create table tt.overrides (tbl text not null, col text not null, expr text not null, primary key (tbl, col));
insert into tt.overrides values
  ('bill_documents',               'checksum_sha256', $$repeat('a', 64)$$),
  ('provider_statements',          'file_sha256',     $$repeat('b', 64)$$),
  ('report_runs',                  'period_start',    $$date '2026-01-01'$$),
  ('report_runs',                  'period_end',      $$date '2026-01-31'$$),
  ('service_code_reports',         'service_code_id', $$extensions.gen_random_uuid()$$),
  ('service_favourites',           'service_code_id', $$extensions.gen_random_uuid()$$),
  ('service_recent_usage',         'service_code_id', $$extensions.gen_random_uuid()$$),
  ('statement_packs',              'pack_id',         $$'OL-PK-20260101-ABCDEF'$$),
  ('statements',                   'statement_id',    $$'OL-ST-20260101-ABCDEF'$$),
  ('transaction_category_history', 'actor_type',      $$'system'$$),
  ('transactions',                 'source',          $$'manual'$$),
  ('trusted_recipients',           'merchant_code',   $$'123456'$$),
  ('webhook_subscriptions',        'url',             $$'https://example.invalid/hook'$$),
  ('categorization_policies',      'merchant_pattern',$$'seed'$$),
  ('budgets',                      'period_start',    $$date '2026-01-01'$$),
  ('budgets',                      'period_end',      $$date '2026-01-31'$$);

-- Value for one NOT NULL, default-less column, from its type or from the single
-- column CHECK that lists literals. NULL = cannot synthesise.
create function tt.synth(p_type regtype, p_rel regclass, p_att name) returns text language plpgsql as $$
declare k char; v text; lit text;
begin
  select (regexp_match(pg_get_constraintdef(co.oid), '''([^'']+)''::'))[1] into lit
    from pg_constraint co
   where co.conrelid = p_rel and co.contype = 'c'
     and co.conkey = array[(select attnum from pg_attribute where attrelid = p_rel and attname = p_att)]
     and pg_get_constraintdef(co.oid) ~ '''[^'']+''::'
   limit 1;
  if lit is not null and p_type::text in ('text', 'character varying', 'character') then
    return quote_literal(lit);
  end if;
  select typtype into k from pg_type where oid = p_type;
  if k = 'e' then
    select quote_literal(enumlabel) || '::' || p_type::text into v
      from pg_enum where enumtypid = p_type order by enumsortorder limit 1;
    return v;
  end if;
  return case
    when p_type::text = 'uuid' then 'extensions.gen_random_uuid()'
    when p_type::text in ('text', 'character varying', 'citext') then quote_literal('seed-' || substr(md5(random()::text), 1, 8))
    when p_type::text = 'character' then '''RWF'''
    when p_type::text in ('integer', 'bigint', 'smallint', 'numeric', 'real', 'double precision') then '1'
    when p_type::text = 'boolean' then 'false'
    when p_type::text in ('timestamp with time zone', 'timestamp without time zone') then 'now()'
    when p_type::text = 'date' then 'current_date'
    when p_type::text = 'jsonb' then '''{}''::jsonb'
    when p_type::text = 'json' then '''{}''::json'
    when p_type::text = 'bytea' then '''\x00''::bytea'
    when p_type::text = 'interval' then '''1 day''::interval'
    when p_type::text like '%[]' then '''{}''::' || p_type::text
    else null
  end;
end $$;

-- Full INSERT statement planting one row in public.<tbl> for workspace p_ws.
-- Returns NULL and sets p_why when a required column cannot be synthesised.
create function tt.build_insert(p_tbl text, p_ws uuid, p_user uuid, out p_sql text, out p_why text) language plpgsql as $$
declare col record; v text; cols text := 'workspace_id'; vals text := quote_literal(p_ws); rel regclass;
begin
  rel := ('public.' || quote_ident(p_tbl))::regclass;
  for col in
    select a.attname, a.atttypid::regtype as rt
      from pg_attribute a
     where a.attrelid = rel and a.attnum > 0 and not a.attisdropped and a.attgenerated = '' and a.attidentity = ''
       and a.attname <> 'workspace_id'
       and ((a.attnotnull and not a.atthasdef) or a.attname = 'user_id'
            or exists (select 1 from tt.overrides o where o.tbl = p_tbl and o.col = a.attname::text))
  loop
    select o.expr into v from tt.overrides o where o.tbl = p_tbl and o.col = col.attname::text;
    -- rows keyed by user as well as workspace belong to the tenant's user, as a real row would
    if v is null and col.attname::text ~ '(^|_)user_id$' and col.rt = 'uuid'::regtype then v := quote_literal(p_user); end if;
    if v is null then v := tt.synth(col.rt, rel, col.attname); end if;
    if v is null then
      p_why := 'cannot synthesise ' || col.attname || ' (' || col.rt || ')';
      return;
    end if;
    cols := cols || ',' || quote_ident(col.attname);
    vals := vals || ',' || v;
  end loop;
  p_sql := format('insert into public.%I (%s) values (%s)', p_tbl, cols, vals);
end $$;

create function tt.act_as(p_user uuid) returns void language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'aal', 'aal1')::text, true);
end $$;

-- UPDATE / DELETE probe that exercises the UPDATE or DELETE policy itself.
-- Postgres also applies SELECT policies to an UPDATE/DELETE that READS a
-- column (WHERE, or the right-hand side of SET), so a probe written
-- `where workspace_id = $1` would pass on the SELECT policy alone. This one
-- reads no columns: no WHERE, a constant on the right of SET. Tenant A's row
-- count is taken as the table owner before and after, and the probe is always
-- rolled back so probes cannot affect each other.
create function tt.probe_write(p_tbl text, p_kind text, p_wa uuid, p_wb uuid, p_ub uuid)
returns text language plpgsql as $$
declare before_n bigint; after_n bigint; sqlst text; res text;
begin
  execute format('select count(*) from public.%I where workspace_id = $1', p_tbl) into before_n using p_wa;
  begin
    perform tt.act_as(p_ub);
    if p_kind = 'update' then
      execute format('update public.%I set workspace_id = $1', p_tbl) using p_wb;
    else
      execute format('delete from public.%I', p_tbl);
    end if;
    reset role;
    execute format('select count(*) from public.%I where workspace_id = $1', p_tbl) into after_n using p_wa;
    res := case when after_n < before_n
                then format('breach: tenant A went from %s to %s rows', before_n, after_n)
                else 'denied' end;
    raise exception using errcode = 'P0001', message = 'tt_rollback';
  exception when others then
    get stacked diagnostics sqlst = returned_sqlstate;
    if sqlerrm = 'tt_rollback' then null;                       -- keep res
    elsif sqlst = '42501' then res := 'denied';                 -- insufficient_privilege / RLS
    elsif sqlst = '23505' then res := 'breach: statement reached tenant A''s row (unique violation)';
    else res := format('inconclusive: %s %s', sqlst, sqlerrm);
    end if;
  end;
  return res;
end $$;

-- ===========================================================================
-- Layer 1: structural
-- ===========================================================================
do $$
declare r record; n int;
begin
  -- 1a. Every table a client role can touch has RLS on.
  for r in
    select c.relname from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
       and exists (select 1 from information_schema.role_table_grants g
                    where g.table_schema = 'public' and g.table_name = c.relname and g.grantee in ('anon', 'authenticated'))
  loop
    perform tt.rec(false, format('RLS is OFF on public.%s, which anon/authenticated can reach', r.relname));
  end loop;
  select count(*) into n from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
     and c.relname not in (select name from tt.allow where kind = 'rls_off');
  perform tt.rec(n = 0, format('every public table has RLS enabled except the allowlisted ones (%s unexpected)', n));

  -- 1b. anon reaches no table and only the allowlisted functions.
  select count(*) into n from information_schema.role_table_grants where table_schema = 'public' and grantee = 'anon';
  perform tt.rec(n = 0, format('anon holds no table grants in public (%s found)', n));
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.prokind = 'f' and has_function_privilege('anon', p.oid, 'execute')
     and p.proname not in (select name from tt.allow where kind = 'anon_function');
  perform tt.rec(n = 0, format('anon can execute only the allowlisted public functions (%s others)', n));
  for r in
    select p.proname from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.prokind = 'f' and has_function_privilege('anon', p.oid, 'execute')
       and p.proname not in (select name from tt.allow where kind = 'anon_function')
  loop
    perform tt.rec(false, format('anon can EXECUTE public.%s() and it is not allowlisted', r.proname));
  end loop;

  -- 1c. No policy exposes every row, except the allowlisted reference tables.
  select count(*) into n from pg_policies
   where schemaname = 'public'
     and (trim(both '() ' from coalesce(qual, '')) = 'true' or trim(both '() ' from coalesce(with_check, '')) = 'true')
     and tablename not in (select name from tt.allow where kind = 'open_select');
  perform tt.rec(n = 0, format('no unallowlisted policy is a blanket USING (true) / WITH CHECK (true) (%s found)', n));
  for r in
    select tablename, policyname, cmd from pg_policies
     where schemaname = 'public'
       and (trim(both '() ' from coalesce(qual, '')) = 'true' or trim(both '() ' from coalesce(with_check, '')) = 'true')
       and tablename not in (select name from tt.allow where kind = 'open_select')
  loop
    perform tt.rec(false, format('policy %s on public.%s (%s) allows every row', r.policyname, r.tablename, r.cmd));
  end loop;

  -- 1d. Open reference tables really are read-only for clients.
  select count(*) into n from information_schema.role_table_grants
   where table_schema = 'public' and grantee = 'authenticated' and privilege_type <> 'SELECT'
     and table_name in (select name from tt.allow where kind = 'open_select');
  perform tt.rec(n = 0, format('allowlisted open reference tables are SELECT-only for authenticated (%s write grants)', n));

  -- 1e. RLS-off tables are unreachable from client roles.
  select count(*) into n from information_schema.role_table_grants
   where table_schema = 'public' and grantee in ('anon', 'authenticated')
     and table_name in (select name from tt.allow where kind = 'rls_off');
  perform tt.rec(n = 0, format('RLS-off allowlisted tables have no client grants (%s found)', n));
end $$;

-- ===========================================================================
-- Layer 2: behavioural, two tenants
-- ===========================================================================
do $$
declare
  ua uuid; ub uuid; wa uuid; wb uuid;
  r record; q record; ins text; n bigint; seeded boolean; why text; sqlst text;
  seeded_tables text[] := '{}'; tname text; kind text; res text; gap text;
  forge_ok int := 0; forge_denied int := 0;
begin
  insert into auth.users (email) values ('tt-a@example.com') returning id into ua;
  insert into auth.users (email) values ('tt-b@example.com') returning id into ub;
  select workspace_id into wa from public.workspace_memberships where user_id = ua limit 1;
  select workspace_id into wb from public.workspace_memberships where user_id = ub limit 1;
  perform tt.rec(wa is not null and wb is not null and wa <> wb, 'two users get two distinct personal workspaces');
  if wa is null or wb is null or wa = wb then return; end if;

  -- Seed as the owner of the database. Triggers and foreign keys are skipped:
  -- the test cares about visibility, not referential realism.
  set local session_replication_role = replica;

  for r in
    select distinct c.table_name as t
      from information_schema.columns c
      join information_schema.role_table_grants g
        on g.table_schema = 'public' and g.table_name = c.table_name
       and g.grantee = 'authenticated' and g.privilege_type = 'SELECT'
     where c.table_schema = 'public' and c.column_name = 'workspace_id'
     order by 1
  loop
    select * into q from tt.build_insert(r.t, wa, ua);
    seeded := false; why := q.p_why;
    if q.p_sql is not null then
      begin
        execute q.p_sql; seeded := true;
      exception
        when unique_violation then seeded := true;  -- provisioning already planted a row for A
        when others then why := sqlerrm;
      end;
    end if;
    if not seeded then
      perform tt.rec(false, format('could not plant a tenant-A row in public.%s (%s): extend tt.overrides', r.t, why));
      continue;
    end if;
    seeded_tables := seeded_tables || r.t;

    -- positive control: A sees at least one row of its own
    perform tt.act_as(ua);
    execute format('select count(*) from public.%I where workspace_id = $1', r.t) into n using wa;
    reset role;
    perform tt.rec(n >= 1, format('%s: tenant A can read its own row (positive control)', r.t));

    -- B reads nothing of A
    perform tt.act_as(ub);
    execute format('select count(*) from public.%I where workspace_id = $1', r.t) into n using wa;
    reset role;
    perform tt.rec(n = 0, format('%s: tenant B reads %s of tenant A''s rows (want 0)', r.t, n));
  end loop;

  -- Forged INSERT / UPDATE / DELETE as B against A's workspace.
  foreach tname in array seeded_tables loop
    if exists (select 1 from information_schema.role_table_grants
                where table_schema = 'public' and table_name = tname and grantee = 'authenticated' and privilege_type = 'INSERT') then
      select * into q from tt.build_insert(tname, wa, ub);  -- B's own identity, A's workspace
      begin
        perform tt.act_as(ub);
        execute q.p_sql;
        reset role;
        select a.why into gap from tt.allow a where a.kind = 'forge_gap' and a.name = tname;
        if gap is not null then
          perform tt.rec(true, format('%s: tenant B inserted a row into tenant A''s workspace - %s', tname, gap));
        else
          perform tt.rec(false, format('%s: tenant B INSERTED a row into tenant A''s workspace', tname));
        end if;
      exception when others then
        get stacked diagnostics sqlst = returned_sqlstate;
        reset role;
        if sqlst = '42501' then
          forge_denied := forge_denied + 1;
          if exists (select 1 from tt.allow a where a.kind = 'forge_gap' and a.name = tname) then
            perform tt.rec(false, format('%s is allowlisted as a known forge gap but B''s insert is now denied: remove it from tt.allow', tname));
          end if;
        else perform tt.rec(false, format('%s: forged insert failed for a non-permission reason (%s: %s), so the probe proves nothing', tname, sqlst, sqlerrm));
        end if;
      end;
    end if;

    foreach kind in array array['update', 'delete'] loop
      if exists (select 1 from information_schema.role_table_grants
                  where table_schema = 'public' and table_name = tname and grantee = 'authenticated'
                    and privilege_type = upper(kind)) then
        res := tt.probe_write(tname, kind, wa, wb, ub);
        perform tt.rec(res = 'denied', format('%s: tenant B %s against tenant A''s rows: %s', tname, kind, res));
      end if;
    end loop;
  end loop;

  perform tt.rec(true, format('swept %s workspace-scoped tables; %s forged inserts denied by RLS', cardinality(seeded_tables), forge_denied));
  -- A catalog that suddenly yields almost no tables means the sweep broke, not that all is well.
  perform tt.rec(cardinality(seeded_tables) >= 60, format('sweep coverage floor: %s tables planted (want >= 60)', cardinality(seeded_tables)));
end $$;

select status || '|' || msg from tt.results order by ord;
