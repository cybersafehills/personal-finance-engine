-- Bills & Expenses - Phase 4: duplicate detection.
--
-- Design of record: docs/bills-and-expenses-design.md (Phase 4 row).
-- Master prompt §10 (duplicate detection and idempotency).
--
-- Exact-file duplicates are already stopped at upload by
-- bill_documents_checksum_unique (Phase 1). This phase adds CONTENT
-- duplicate detection: after validation, the worker compares a
-- document's extracted identity (invoice/receipt number, supplier,
-- date, currency, amount) against every other non-terminal document in
-- the workspace and records ranked candidates. Nothing is ever
-- auto-deleted or auto-merged (master prompt §10) - an authorised
-- reviewer resolves each candidate (keep both / merge intent / dismiss).
--
-- Purely additive: one table, three service_role/authenticated functions.
--
-- !! PRE-MERGE: run supabase/migrations/tests/run_migration_tests.sh
--    (PostgreSQL 17). The "Bills Phase 4" block covers
--    record_bill_duplicate_candidates being service_role-only,
--    get_bill_document_fingerprints returning current-extraction rows,
--    resolve_bill_duplicate_candidate being bill.review-gated, and
--    cross-workspace RLS.

-- ===========================================================================
-- bill_duplicate_candidates - one row per (subject document, prior
-- document) pair the detector flags. is_current is cleared when the
-- detector re-runs for the subject.
-- ===========================================================================

create table public.bill_duplicate_candidates (
  id uuid primary key default gen_random_uuid(),
  -- The newer document being checked.
  bill_document_id uuid not null references public.bill_documents (id) on delete cascade,
  workspace_id uuid not null,
  -- The prior document it may duplicate.
  candidate_document_id uuid not null references public.bill_documents (id) on delete cascade,
  is_current boolean not null default true,

  relation text not null
    check (relation in ('exact', 'probable', 'similar', 'recurring', 'multi_file')),
  score numeric(5, 4) not null check (score >= 0 and score <= 1),
  signals text[] not null default array[]::text[],
  detail jsonb,

  resolution text not null default 'unresolved'
    check (resolution in ('unresolved', 'kept_both', 'merged', 'dismissed')),
  resolved_by uuid references auth.users (id) on delete set null,
  resolved_at timestamptz,

  created_at timestamptz not null default now(),

  constraint bill_duplicate_candidates_not_self
    check (bill_document_id <> candidate_document_id),
  constraint bill_duplicate_candidates_subject_same_workspace
    foreign key (workspace_id, bill_document_id)
    references public.bill_documents (workspace_id, id),
  constraint bill_duplicate_candidates_candidate_same_workspace
    foreign key (workspace_id, candidate_document_id)
    references public.bill_documents (workspace_id, id)
);

comment on table public.bill_duplicate_candidates is
  'One flagged (newer document, prior document) pair from content-duplicate detection (master prompt §10). Never auto-resolved; a bill.review holder sets resolution. relation=merged records intent only in Phase 4 - the actual merge is Phase 6.';

create unique index bill_duplicate_candidates_unique_current
  on public.bill_duplicate_candidates (bill_document_id, candidate_document_id)
  where is_current;
create index idx_bill_duplicate_candidates_open
  on public.bill_duplicate_candidates (bill_document_id)
  where is_current and resolution = 'unresolved';
create index idx_bill_duplicate_candidates_workspace
  on public.bill_duplicate_candidates (workspace_id, created_at desc);

-- ===========================================================================
-- get_bill_document_fingerprints - the per-workspace comparison set for
-- the detector. Returns, for every non-terminal document except the one
-- being checked, the identity fields from its current extraction.
-- SERVICE_ROLE ONLY (called by the worker). Terminal states
-- (rejected / processing_failed / archived) and the subject itself are
-- excluded.
-- ===========================================================================

create function public.get_bill_document_fingerprints(
  p_workspace_id uuid,
  p_exclude_document_id uuid
)
returns table (
  bill_document_id uuid,
  status text,
  supplier_name text,
  invoice_number text,
  receipt_number text,
  issue_date text,
  currency text,
  total_minor text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    d.id,
    d.status,
    max(f.normalized_value) filter (where f.field_key = 'supplier_name'),
    max(f.normalized_value) filter (where f.field_key = 'invoice_number'),
    max(f.normalized_value) filter (where f.field_key = 'receipt_number'),
    max(f.normalized_value) filter (where f.field_key = 'issue_date'),
    max(coalesce(f.normalized_value, f.raw_value)) filter (where f.field_key = 'currency'),
    max(f.normalized_value) filter (where f.field_key = 'total')
  from public.bill_documents d
  join public.bill_extractions e
    on e.bill_document_id = d.id and e.is_current
  left join public.bill_extracted_fields f
    on f.extraction_id = e.id
   and f.field_key in ('supplier_name', 'invoice_number', 'receipt_number', 'issue_date', 'currency', 'total')
  where d.workspace_id = p_workspace_id
    and d.id <> p_exclude_document_id
    and d.status not in ('rejected', 'processing_failed', 'archived', 'uploading', 'received', 'stored')
  group by d.id, d.status;
$$;

comment on function public.get_bill_document_fingerprints is
  'Worker-only (service_role). The comparison set for content-duplicate detection: current-extraction identity fields for every non-terminal document in the workspace except the one being checked.';

revoke all on function public.get_bill_document_fingerprints(uuid, uuid) from public;
grant execute on function public.get_bill_document_fingerprints(uuid, uuid) to service_role;

-- ===========================================================================
-- record_bill_duplicate_candidates - the worker's write point. Replaces
-- the subject document's current candidate set. SERVICE_ROLE ONLY.
--
-- payload:
--   { bill_document_id, workspace_id,
--     candidates:[ { candidate_document_id, relation, score, signals:[...], detail } ] }
-- ===========================================================================

create function public.record_bill_duplicate_candidates(payload jsonb)
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
  if not exists (
    select 1 from public.bill_documents where id = v_doc and workspace_id = v_ws
  ) then
    raise exception 'not_found: bill_document % / workspace %', v_doc, v_ws
      using errcode = 'no_data_found';
  end if;

  update public.bill_duplicate_candidates set is_current = false
  where bill_document_id = v_doc and is_current;

  for v_cand in select * from jsonb_array_elements(coalesce(payload->'candidates', '[]'::jsonb)) loop
    insert into public.bill_duplicate_candidates (
      bill_document_id, workspace_id, candidate_document_id, is_current,
      relation, score, signals, detail
    ) values (
      v_doc, v_ws,
      (v_cand->>'candidate_document_id')::uuid,
      true,
      coalesce(nullif(v_cand->>'relation', ''), 'similar'),
      coalesce(nullif(v_cand->>'score', '')::numeric, 0),
      coalesce(
        (select array_agg(x) from jsonb_array_elements_text(coalesce(v_cand->'signals', '[]'::jsonb)) as t(x)),
        array[]::text[]
      ),
      v_cand->'detail'
    )
    on conflict (bill_document_id, candidate_document_id) where is_current do nothing;
    v_count := v_count + 1;
  end loop;

  if v_count > 0 then
    perform public.record_bill_event(
      v_doc, v_ws, 'system', 'duplicate_detected', null, null, 'ok',
      jsonb_build_object('candidates', v_count)
    );
  end if;

  return jsonb_build_object('ok', true, 'candidates', v_count);
end;
$$;

comment on function public.record_bill_duplicate_candidates is
  'Worker-only (service_role). Replaces the subject document''s current duplicate-candidate set and emits a duplicate_detected journal event when any are found. Never resolves or deletes anything.';

revoke all on function public.record_bill_duplicate_candidates(jsonb) from public;
grant execute on function public.record_bill_duplicate_candidates(jsonb) to service_role;

-- ===========================================================================
-- resolve_bill_duplicate_candidate - an authorised reviewer's decision on
-- one candidate. bill.review-gated. 'merged' records intent only in
-- Phase 4 (the actual document/transaction merge is Phase 6).
-- ===========================================================================

create function public.resolve_bill_duplicate_candidate(
  p_id uuid,
  p_resolution text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws uuid;
  v_doc uuid;
begin
  if p_resolution not in ('kept_both', 'merged', 'dismissed') then
    raise exception 'invalid_resolution' using errcode = 'check_violation';
  end if;

  select workspace_id, bill_document_id into v_ws, v_doc
  from public.bill_duplicate_candidates where id = p_id for update;
  if v_ws is null then
    raise exception 'not_found' using errcode = 'no_data_found';
  end if;
  if not public.is_workspace_member(v_ws, 'member') then
    raise exception 'not_authorized' using errcode = 'insufficient_privilege';
  end if;
  if not public.has_space_capability(v_ws, 'bill.review') then
    raise exception 'not_authorized: bill.review required' using errcode = 'insufficient_privilege';
  end if;

  update public.bill_duplicate_candidates
  set resolution = p_resolution, resolved_by = auth.uid(), resolved_at = now()
  where id = p_id;

  perform public.record_bill_event(
    v_doc, v_ws, 'user', 'duplicate_detected', null, null, 'ok',
    jsonb_build_object('resolution', p_resolution, 'candidate_id', p_id)
  );
  perform public.record_space_audit_event(
    v_ws, 'bill.duplicate_resolved', 'bill_document', v_doc,
    null, jsonb_build_object('resolution', p_resolution, 'candidate_id', p_id)
  );

  return jsonb_build_object('ok', true, 'resolution', p_resolution);
end;
$$;

comment on function public.resolve_bill_duplicate_candidate is
  'A bill.review holder resolves one duplicate candidate (kept_both / merged / dismissed). merged is intent-only in Phase 4. Writes a journal + space audit event.';

revoke all on function public.resolve_bill_duplicate_candidate(uuid, text) from public;
grant execute on function public.resolve_bill_duplicate_candidate(uuid, text) to authenticated, service_role;

-- ===========================================================================
-- RLS
-- ===========================================================================

alter table public.bill_duplicate_candidates enable row level security;

create policy bill_duplicate_candidates_select_member on public.bill_duplicate_candidates
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

revoke all on public.bill_duplicate_candidates from anon;
grant select on public.bill_duplicate_candidates to authenticated;
grant select, insert, update, delete on public.bill_duplicate_candidates to service_role;
