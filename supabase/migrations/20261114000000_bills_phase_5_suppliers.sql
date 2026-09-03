-- Bills & Expenses - Phase 5: supplier resolution.
--
-- Design of record: docs/bills-and-expenses-design.md (Phase 5 row).
-- Master prompt §11 (supplier resolution).
--
-- The first supplier-of-record entity in this schema (trusted_recipients
-- / directory_sources / merchant_rules are none of them). Tenant-scoped.
-- Before creating a supplier the reviewer sees ranked existing matches;
-- suppliers are NEVER auto-merged on name similarity (master prompt §11).
--
-- Purely additive: three new tables, one nullable column on
-- bill_documents, five functions.
--
-- !! PRE-MERGE: run supabase/migrations/tests/run_migration_tests.sh
--    (PostgreSQL 17). The "Bills Phase 5" block covers search_suppliers
--    ranking, create_supplier being bill.manage-gated + its tax_id
--    guard, link_bill_supplier being bill.review-gated,
--    record_bill_supplier_candidates being service_role-only, and
--    cross-workspace RLS.

-- ===========================================================================
-- suppliers - tenant-scoped supplier of record.
-- ===========================================================================

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null,

  display_name text not null check (length(trim(both from display_name)) > 0),
  -- Lowercased, suffix-stripped comparison key (web/lib/bills/normalize.ts
  -- normalizeSupplierName). Set by create_supplier / the reviewer, never
  -- shown. Non-unique - two real suppliers may normalise the same and the
  -- product must not silently merge them.
  name_key text not null check (length(trim(both from name_key)) > 0),

  tax_id text,
  email text,
  phone text,
  address text,
  bank_details jsonb,

  status text not null default 'active' check (status in ('active', 'archived')),
  source text not null default 'manual'
    check (source in ('manual', 'document_extracted', 'imported')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint suppliers_workspace_id_id_unique unique (workspace_id, id)
);

comment on table public.suppliers is
  'Tenant-scoped supplier of record for Bills & Expenses (master prompt §11). name_key is a comparison key only - it is deliberately NOT unique, so two genuinely different suppliers that normalise the same are never silently merged. A TIN, when present, is unique per workspace.';

create trigger set_suppliers_updated_at
  before update on public.suppliers
  for each row execute function public.set_updated_at();

-- A tax id, when present, uniquely identifies a supplier within a
-- workspace - this IS a safe uniqueness key.
create unique index suppliers_workspace_tax_id_unique
  on public.suppliers (workspace_id, lower(tax_id))
  where tax_id is not null and status = 'active';
create index idx_suppliers_workspace_name_key
  on public.suppliers (workspace_id, name_key) where status = 'active';

-- ===========================================================================
-- supplier_aliases - alternate names a supplier is known by (from prior
-- documents, or entered by a reviewer). Feeds search, never display.
-- ===========================================================================

create table public.supplier_aliases (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers (id) on delete cascade,
  workspace_id uuid not null,
  alias text not null check (length(trim(both from alias)) > 0),
  alias_key text not null,
  source text not null default 'manual'
    check (source in ('manual', 'document_extracted', 'imported')),
  created_at timestamptz not null default now(),

  constraint supplier_aliases_supplier_same_workspace
    foreign key (workspace_id, supplier_id)
    references public.suppliers (workspace_id, id),
  constraint supplier_aliases_unique unique (supplier_id, alias_key)
);

create index idx_supplier_aliases_workspace_key
  on public.supplier_aliases (workspace_id, alias_key);

-- ===========================================================================
-- bill_documents.supplier_id - the reviewer-confirmed supplier link.
-- ===========================================================================

alter table public.bill_documents
  add column supplier_id uuid references public.suppliers (id) on delete set null;

comment on column public.bill_documents.supplier_id is
  'The supplier a reviewer confirmed for this document (link_bill_supplier). NULL until confirmed. Never set automatically.';

create index idx_bill_documents_supplier on public.bill_documents (supplier_id);

-- ===========================================================================
-- bill_supplier_candidates - ranked existing-supplier matches the worker
-- generated for a document. is_current cleared on re-run.
-- ===========================================================================

create table public.bill_supplier_candidates (
  id uuid primary key default gen_random_uuid(),
  bill_document_id uuid not null references public.bill_documents (id) on delete cascade,
  workspace_id uuid not null,
  supplier_id uuid not null references public.suppliers (id) on delete cascade,
  is_current boolean not null default true,
  score numeric(5, 4) not null check (score >= 0 and score <= 1),
  match_reasons text[] not null default array[]::text[],
  created_at timestamptz not null default now(),

  constraint bill_supplier_candidates_doc_same_workspace
    foreign key (workspace_id, bill_document_id)
    references public.bill_documents (workspace_id, id),
  constraint bill_supplier_candidates_supplier_same_workspace
    foreign key (workspace_id, supplier_id)
    references public.suppliers (workspace_id, id)
);

create unique index bill_supplier_candidates_unique_current
  on public.bill_supplier_candidates (bill_document_id, supplier_id)
  where is_current;
create index idx_bill_supplier_candidates_doc
  on public.bill_supplier_candidates (bill_document_id) where is_current;

-- ===========================================================================
-- search_suppliers - ranked tenant-scoped supplier search. Member-gated;
-- also callable by the worker (service_role). Matches on exact TIN,
-- exact / prefix / contains name_key, and alias_key.
-- ===========================================================================

create function public.search_suppliers(
  p_workspace_id uuid,
  p_query text default null,
  p_tax_id text default null,
  p_limit integer default 10
)
returns table (
  id uuid,
  display_name text,
  name_key text,
  tax_id text,
  email text,
  phone text,
  score numeric,
  match_reasons text[]
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_q text := nullif(lower(trim(both from coalesce(p_query, ''))), '');
  v_tin text := nullif(lower(trim(both from coalesce(p_tax_id, ''))), '');
begin
  if not public.is_workspace_member(p_workspace_id) then
    raise exception 'not_authorized' using errcode = 'insufficient_privilege';
  end if;

  return query
  with scored as (
    select
      s.id, s.display_name, s.name_key, s.tax_id, s.email, s.phone,
      greatest(
        case when v_tin is not null and lower(s.tax_id) = v_tin then 0.99 else 0 end,
        case when v_q is not null and s.name_key = v_q then 0.90 else 0 end,
        case when v_q is not null and s.name_key like v_q || '%' then 0.70 else 0 end,
        case when v_q is not null and position(v_q in s.name_key) > 0 then 0.55 else 0 end,
        case when v_q is not null and exists (
          select 1 from public.supplier_aliases a
          where a.supplier_id = s.id
            and (a.alias_key = v_q or position(v_q in a.alias_key) > 0)
        ) then 0.75 else 0 end
      )::numeric as score,
      (
        array_remove(array[
          case when v_tin is not null and lower(s.tax_id) = v_tin then 'tax_id' end,
          case when v_q is not null and s.name_key = v_q then 'name_exact' end,
          case when v_q is not null and s.name_key <> v_q and position(v_q in s.name_key) > 0 then 'name_partial' end,
          case when v_q is not null and exists (
            select 1 from public.supplier_aliases a where a.supplier_id = s.id and a.alias_key = v_q
          ) then 'alias' end
        ], null)
      ) as match_reasons
    from public.suppliers s
    where s.workspace_id = p_workspace_id
      and s.status = 'active'
  )
  select scored.id, scored.display_name, scored.name_key, scored.tax_id,
         scored.email, scored.phone, scored.score, scored.match_reasons
  from scored
  where scored.score > 0
  order by scored.score desc, scored.display_name asc
  limit greatest(1, least(coalesce(p_limit, 10), 50));
end;
$$;

comment on function public.search_suppliers is
  'Ranked tenant-scoped supplier search by TIN / name_key / alias_key. Member-gated. Used by the reviewer UI and the worker.';

revoke all on function public.search_suppliers(uuid, text, text, integer) from public;
grant execute on function public.search_suppliers(uuid, text, text, integer) to authenticated, service_role;

-- ===========================================================================
-- create_supplier - permissioned supplier creation (master prompt §11:
-- "Require appropriate permission"). bill.manage-gated. Refuses a
-- duplicate TIN within the workspace (returns the existing id rather than
-- raising). Records a space audit event.
--
-- payload: { workspace_id, display_name, name_key, tax_id, email, phone,
--            address, bank_details, source, aliases:[{alias, alias_key}] }
-- ===========================================================================

create function public.create_supplier(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws uuid := (payload->>'workspace_id')::uuid;
  v_id uuid;
  v_existing uuid;
  v_tax text := nullif(trim(both from coalesce(payload->>'tax_id', '')), '');
  v_alias jsonb;
begin
  if v_ws is null then
    raise exception 'invalid_payload: workspace_id required' using errcode = 'check_violation';
  end if;
  if not public.is_workspace_member(v_ws, 'member') then
    raise exception 'not_authorized' using errcode = 'insufficient_privilege';
  end if;
  if not public.has_space_capability(v_ws, 'bill.manage') then
    raise exception 'not_authorized: bill.manage required' using errcode = 'insufficient_privilege';
  end if;
  if length(trim(both from coalesce(payload->>'display_name', ''))) = 0 then
    raise exception 'invalid_payload: display_name required' using errcode = 'check_violation';
  end if;

  if v_tax is not null then
    select id into v_existing from public.suppliers
    where workspace_id = v_ws and lower(tax_id) = lower(v_tax) and status = 'active';
    if v_existing is not null then
      return jsonb_build_object('ok', false, 'error', 'tax_id_exists', 'existing_id', v_existing);
    end if;
  end if;

  insert into public.suppliers (
    workspace_id, created_by, display_name, name_key, tax_id, email, phone,
    address, bank_details, source
  ) values (
    v_ws, auth.uid(),
    payload->>'display_name',
    coalesce(nullif(payload->>'name_key', ''), lower(trim(both from payload->>'display_name'))),
    v_tax,
    nullif(payload->>'email', ''),
    nullif(payload->>'phone', ''),
    nullif(payload->>'address', ''),
    payload->'bank_details',
    coalesce(nullif(payload->>'source', ''), 'manual')
  )
  returning id into v_id;

  for v_alias in select * from jsonb_array_elements(coalesce(payload->'aliases', '[]'::jsonb)) loop
    insert into public.supplier_aliases (supplier_id, workspace_id, alias, alias_key, source)
    values (
      v_id, v_ws, v_alias->>'alias',
      coalesce(nullif(v_alias->>'alias_key', ''), lower(trim(both from v_alias->>'alias'))),
      coalesce(nullif(v_alias->>'source', ''), 'manual')
    )
    on conflict (supplier_id, alias_key) do nothing;
  end loop;

  perform public.record_space_audit_event(
    v_ws, 'bill.supplier_created', 'supplier', v_id,
    null, jsonb_build_object('display_name', payload->>'display_name', 'has_tax_id', v_tax is not null)
  );

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

comment on function public.create_supplier is
  'Permissioned (bill.manage) supplier creation. Refuses a duplicate active TIN in the workspace (returns existing_id). Writes a space audit event. Never merges.';

revoke all on function public.create_supplier(jsonb) from public;
grant execute on function public.create_supplier(jsonb) to authenticated;

-- ===========================================================================
-- link_bill_supplier - a reviewer confirms (or clears) the supplier for a
-- document. bill.review-gated.
-- ===========================================================================

create function public.link_bill_supplier(
  p_bill_document_id uuid,
  p_supplier_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws uuid;
begin
  select workspace_id into v_ws from public.bill_documents
  where id = p_bill_document_id for update;
  if v_ws is null then
    raise exception 'not_found' using errcode = 'no_data_found';
  end if;
  if not public.is_workspace_member(v_ws, 'member') then
    raise exception 'not_authorized' using errcode = 'insufficient_privilege';
  end if;
  if not public.has_space_capability(v_ws, 'bill.review') then
    raise exception 'not_authorized: bill.review required' using errcode = 'insufficient_privilege';
  end if;

  if p_supplier_id is not null and not exists (
    select 1 from public.suppliers
    where id = p_supplier_id and workspace_id = v_ws and status = 'active'
  ) then
    raise exception 'invalid_supplier' using errcode = 'foreign_key_violation';
  end if;

  update public.bill_documents set supplier_id = p_supplier_id
  where id = p_bill_document_id;

  perform public.record_bill_event(
    p_bill_document_id, v_ws, 'user',
    case when p_supplier_id is null then 'supplier_unlinked' else 'supplier_linked' end,
    null, null, 'ok',
    jsonb_build_object('supplier_id', p_supplier_id)
  );

  return jsonb_build_object('ok', true, 'supplier_id', p_supplier_id);
end;
$$;

comment on function public.link_bill_supplier is
  'A bill.review holder confirms or clears the supplier for a document. Never set automatically.';

revoke all on function public.link_bill_supplier(uuid, uuid) from public;
grant execute on function public.link_bill_supplier(uuid, uuid) to authenticated, service_role;

-- ===========================================================================
-- record_bill_supplier_candidates - the worker's write point. SERVICE
-- ROLE ONLY. Replaces the document's current candidate set.
--
-- payload: { bill_document_id, workspace_id,
--            candidates:[{ supplier_id, score, match_reasons:[...] }] }
-- ===========================================================================

create function public.record_bill_supplier_candidates(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc uuid := (payload->>'bill_document_id')::uuid;
  v_ws uuid := (payload->>'workspace_id')::uuid;
  v_cand jsonb;
  v_count int := 0;
begin
  if not exists (select 1 from public.bill_documents where id = v_doc and workspace_id = v_ws) then
    raise exception 'not_found' using errcode = 'no_data_found';
  end if;

  update public.bill_supplier_candidates set is_current = false
  where bill_document_id = v_doc and is_current;

  for v_cand in select * from jsonb_array_elements(coalesce(payload->'candidates', '[]'::jsonb)) loop
    insert into public.bill_supplier_candidates (
      bill_document_id, workspace_id, supplier_id, is_current, score, match_reasons
    ) values (
      v_doc, v_ws, (v_cand->>'supplier_id')::uuid, true,
      coalesce(nullif(v_cand->>'score', '')::numeric, 0),
      coalesce(
        (select array_agg(x) from jsonb_array_elements_text(coalesce(v_cand->'match_reasons', '[]'::jsonb)) as t(x)),
        array[]::text[]
      )
    )
    on conflict (bill_document_id, supplier_id) where is_current do nothing;
    v_count := v_count + 1;
  end loop;

  if v_count > 0 then
    perform public.record_bill_event(
      v_doc, v_ws, 'system', 'supplier_candidate_generated', null, null, 'ok',
      jsonb_build_object('candidates', v_count)
    );
  end if;

  return jsonb_build_object('ok', true, 'candidates', v_count);
end;
$$;

comment on function public.record_bill_supplier_candidates is
  'Worker-only (service_role). Replaces a document''s current supplier-candidate set. Never links.';

revoke all on function public.record_bill_supplier_candidates(jsonb) from public;
grant execute on function public.record_bill_supplier_candidates(jsonb) to service_role;

-- ===========================================================================
-- RLS
-- ===========================================================================

alter table public.suppliers enable row level security;
alter table public.supplier_aliases enable row level security;
alter table public.bill_supplier_candidates enable row level security;

create policy suppliers_select_member on public.suppliers
  for select to authenticated
  using (public.is_workspace_member(workspace_id));
create policy supplier_aliases_select_member on public.supplier_aliases
  for select to authenticated
  using (public.is_workspace_member(workspace_id));
create policy bill_supplier_candidates_select_member on public.bill_supplier_candidates
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

revoke all on public.suppliers, public.supplier_aliases,
  public.bill_supplier_candidates from anon;

grant select on public.suppliers to authenticated;
grant select on public.supplier_aliases to authenticated;
grant select on public.bill_supplier_candidates to authenticated;

grant select, insert, update, delete on public.suppliers to service_role;
grant select, insert, update, delete on public.supplier_aliases to service_role;
grant select, insert, update, delete on public.bill_supplier_candidates to service_role;
