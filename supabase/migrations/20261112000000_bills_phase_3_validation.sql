-- Bills & Expenses - Phase 3: deterministic validation + exception
-- detection.
--
-- Design of record: docs/bills-and-expenses-design.md (Phase 3 row).
-- Master prompt §9 (validation and exception detection).
--
-- The validation engine is DETERMINISTIC and EXPLAINABLE, and separate
-- from extraction (master prompt §9): every finding carries a stable
-- rule_id, a user-readable title + detail, the affected fields, a
-- severity, whether it blocks approval, and a suggested action. The
-- engine itself is pure TypeScript (web/lib/bills/validation/); this
-- migration is just the storage + the worker's write point.
--
-- Purely additive: two new tables, one new service_role-only RPC, and a
-- CREATE OR REPLACE of Phase 2's record_bill_extraction so a successful
-- extraction now lands at 'validating' (it previously jumped straight to
-- 'needs_review' - see that function's own comment, which anticipated
-- this). The worker then runs the engine and calls record_bill_validation
-- to move 'validating' -> 'needs_review'. Every document still goes to
-- human review in the first release regardless of findings.
--
-- !! PRE-MERGE: run supabase/migrations/tests/run_migration_tests.sh
--    (PostgreSQL 17). The "Bills Phase 3" block covers record_bill_
--    validation being service_role-only, a full run inserting findings +
--    advancing validating -> needs_review, is_current supersession, and
--    cross-workspace RLS.

-- ===========================================================================
-- bill_validations - one run of the deterministic rule engine over a
-- document's current extraction. is_current partial-unique, like
-- bill_extractions.
-- ===========================================================================

create table public.bill_validations (
  id uuid primary key default gen_random_uuid(),
  bill_document_id uuid not null references public.bill_documents (id) on delete cascade,
  workspace_id uuid not null,
  extraction_id uuid references public.bill_extractions (id) on delete set null,
  status text not null default 'succeeded'
    check (status in ('succeeded', 'failed')),
  is_current boolean not null default false,
  ruleset_version text not null default 'bills-validate-v1',
  blocking_count integer not null default 0 check (blocking_count >= 0),
  warning_count integer not null default 0 check (warning_count >= 0),
  info_count integer not null default 0 check (info_count >= 0),
  error jsonb,
  created_at timestamptz not null default now(),

  constraint bill_validations_document_same_workspace
    foreign key (workspace_id, bill_document_id)
    references public.bill_documents (workspace_id, id)
);

comment on table public.bill_validations is
  'One deterministic rule-engine run over a document''s current extraction (master prompt §9). Advisory + explanatory; every document still goes to human review in the first release. Exactly one is_current per document.';

create unique index bill_validations_one_current
  on public.bill_validations (bill_document_id)
  where is_current;
create index idx_bill_validations_document
  on public.bill_validations (bill_document_id, created_at desc);

-- ===========================================================================
-- bill_validation_findings - one row per finding. rule_id is stable
-- across runs so a reviewer / analytics can track a specific check.
-- ===========================================================================

create table public.bill_validation_findings (
  id uuid primary key default gen_random_uuid(),
  validation_id uuid not null references public.bill_validations (id) on delete cascade,
  bill_document_id uuid not null references public.bill_documents (id) on delete cascade,
  workspace_id uuid not null,
  rule_id text not null check (length(trim(both from rule_id)) > 0),
  severity text not null
    check (severity in ('info', 'warning', 'blocking', 'possible_duplicate', 'needs_specialist')),
  title text not null check (length(trim(both from title)) > 0),
  detail text not null default '',
  affected_fields text[] not null default array[]::text[],
  blocks_approval boolean not null default false,
  suggested_action text,
  ruleset_version text not null default 'bills-validate-v1',
  created_at timestamptz not null default now(),

  constraint bill_validation_findings_document_same_workspace
    foreign key (workspace_id, bill_document_id)
    references public.bill_documents (workspace_id, id),
  constraint bill_validation_findings_unique_rule unique (validation_id, rule_id)
);

comment on table public.bill_validation_findings is
  'One deterministic validation finding. rule_id is stable across runs. detail names the specific inconsistency - never a vague "unusual information detected" (master prompt §9). blocks_approval is advisory in the first release (all documents are human-reviewed) but is honoured by the Phase 6 approve_bill guard.';

create index idx_bill_validation_findings_validation
  on public.bill_validation_findings (validation_id);
create index idx_bill_validation_findings_document
  on public.bill_validation_findings (bill_document_id, severity);

-- ===========================================================================
-- record_bill_validation - the worker's write point for a completed
-- validation run. SERVICE_ROLE ONLY. Inserts the run + findings, flips
-- is_current, writes a journal event, and advances
-- 'validating' -> 'needs_review' (or leaves the document where it is if
-- it has already moved on - the call is a safe no-op then).
--
-- payload:
--   { bill_document_id, workspace_id, extraction_id, status:'succeeded'|'failed',
--     ruleset_version, error,
--     findings:[ { rule_id, severity, title, detail, affected_fields:[...],
--                  blocks_approval, suggested_action } ] }
-- ===========================================================================

create function public.record_bill_validation(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc uuid := (payload->>'bill_document_id')::uuid;
  v_ws uuid := (payload->>'workspace_id')::uuid;
  v_status text := coalesce(payload->>'status', 'failed');
  v_from text;
  v_validation_id uuid;
  v_finding jsonb;
  v_blocking int := 0;
  v_warning int := 0;
  v_info int := 0;
  v_sev text;
begin
  select status into v_from from public.bill_documents
  where id = v_doc and workspace_id = v_ws for update;
  if v_from is null then
    raise exception 'not_found: bill_document % / workspace %', v_doc, v_ws
      using errcode = 'no_data_found';
  end if;

  for v_finding in select * from jsonb_array_elements(coalesce(payload->'findings', '[]'::jsonb)) loop
    v_sev := v_finding->>'severity';
    if v_sev = 'blocking' then v_blocking := v_blocking + 1;
    elsif v_sev = 'warning' then v_warning := v_warning + 1;
    elsif v_sev = 'info' then v_info := v_info + 1;
    end if;
  end loop;

  update public.bill_validations set is_current = false
  where bill_document_id = v_doc and is_current;

  insert into public.bill_validations (
    bill_document_id, workspace_id, extraction_id, status, is_current,
    ruleset_version, blocking_count, warning_count, info_count, error
  ) values (
    v_doc, v_ws,
    nullif(payload->>'extraction_id', '')::uuid,
    v_status, (v_status = 'succeeded'),
    coalesce(nullif(payload->>'ruleset_version', ''), 'bills-validate-v1'),
    v_blocking, v_warning, v_info,
    payload->'error'
  )
  returning id into v_validation_id;

  if v_status = 'succeeded' then
    for v_finding in select * from jsonb_array_elements(coalesce(payload->'findings', '[]'::jsonb)) loop
      insert into public.bill_validation_findings (
        validation_id, bill_document_id, workspace_id, rule_id, severity,
        title, detail, affected_fields, blocks_approval, suggested_action, ruleset_version
      ) values (
        v_validation_id, v_doc, v_ws,
        v_finding->>'rule_id',
        v_finding->>'severity',
        v_finding->>'title',
        coalesce(v_finding->>'detail', ''),
        coalesce(
          (select array_agg(x) from jsonb_array_elements_text(coalesce(v_finding->'affected_fields', '[]'::jsonb)) as t(x)),
          array[]::text[]
        ),
        coalesce((v_finding->>'blocks_approval')::boolean, false),
        nullif(v_finding->>'suggested_action', ''),
        coalesce(nullif(payload->>'ruleset_version', ''), 'bills-validate-v1')
      )
      on conflict (validation_id, rule_id) do nothing;
    end loop;
  end if;

  perform public.record_bill_event(
    v_doc, v_ws, 'system', 'validation_completed', v_from, null,
    case when v_status = 'succeeded' then 'ok' else 'failed' end,
    jsonb_build_object('blocking', v_blocking, 'warning', v_warning, 'info', v_info)
  );

  -- Advance to review. Even a 'failed' validation run advances - a
  -- reviewer must still see the document (master prompt §4: a failure
  -- must not leave the document in an ambiguous state).
  if v_from = 'validating' then
    update public.bill_documents set status = 'needs_review', processing_error = null
    where id = v_doc;
    perform public.record_bill_event(
      v_doc, v_ws, 'system', 'status_changed', 'validating', 'needs_review', 'ok'
    );
  end if;

  return jsonb_build_object(
    'ok', true, 'validation_id', v_validation_id,
    'blocking', v_blocking, 'warning', v_warning, 'info', v_info
  );
end;
$$;

comment on function public.record_bill_validation is
  'Worker-only (service_role) write point for a completed validation run: inserts the run + findings, flips is_current, writes a journal event, and moves validating -> needs_review. Not authenticated-callable.';

revoke all on function public.record_bill_validation(jsonb) from public;
grant execute on function public.record_bill_validation(jsonb) to service_role;

-- ===========================================================================
-- record_bill_extraction - re-issued so a successful run lands at
-- 'validating' instead of 'needs_review'. Byte-identical to the Phase 2
-- definition except the three marked lines. CREATE OR REPLACE preserves
-- the existing grant.
-- ===========================================================================

create or replace function public.record_bill_extraction(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc uuid := (payload->>'bill_document_id')::uuid;
  v_ws uuid := (payload->>'workspace_id')::uuid;
  v_status text := coalesce(payload->>'status', 'failed');
  v_from text;
  v_extraction_id uuid;
  v_field jsonb;
  v_line jsonb;
begin
  select status into v_from from public.bill_documents
  where id = v_doc and workspace_id = v_ws for update;
  if v_from is null then
    raise exception 'not_found: bill_document % / workspace %', v_doc, v_ws
      using errcode = 'no_data_found';
  end if;

  update public.bill_extractions set is_current = false
  where bill_document_id = v_doc and is_current;

  insert into public.bill_extractions (
    bill_document_id, workspace_id, status, is_current,
    doc_class, doc_class_confidence, doc_class_signals,
    provider, model, ruleset_version, request_id, duration_ms, usage,
    error, started_at, completed_at
  ) values (
    v_doc, v_ws, v_status, (v_status = 'succeeded'),
    nullif(payload->>'doc_class', ''),
    nullif(payload->>'doc_class_confidence', '')::numeric,
    payload->'doc_class_signals',
    nullif(payload->>'provider', ''),
    nullif(payload->>'model', ''),
    coalesce(nullif(payload->>'ruleset_version', ''), 'bills-extract-v1'),
    nullif(payload->>'request_id', ''),
    nullif(payload->>'duration_ms', '')::integer,
    payload->'usage',
    payload->'error',
    now(), now()
  )
  returning id into v_extraction_id;

  if v_status = 'succeeded' then
    for v_field in select * from jsonb_array_elements(coalesce(payload->'fields', '[]'::jsonb)) loop
      insert into public.bill_extracted_fields (
        extraction_id, bill_document_id, workspace_id, field_key, value_type,
        raw_value, normalized_value, currency, confidence, source_page, bbox, method
      ) values (
        v_extraction_id, v_doc, v_ws,
        v_field->>'field_key',
        coalesce(nullif(v_field->>'value_type', ''), 'string'),
        v_field->>'raw_value',
        v_field->>'normalized_value',
        nullif(v_field->>'currency', ''),
        nullif(v_field->>'confidence', '')::numeric,
        nullif(v_field->>'source_page', '')::integer,
        v_field->'bbox',
        nullif(v_field->>'method', '')
      )
      on conflict (extraction_id, field_key) do nothing;
    end loop;

    for v_line in select * from jsonb_array_elements(coalesce(payload->'line_items', '[]'::jsonb)) loop
      insert into public.bill_line_items (
        extraction_id, bill_document_id, workspace_id, line_index, description,
        quantity, unit, unit_price_minor, currency, tax_rate, tax_amount_minor,
        discount_minor, line_total_minor, confidence, source_page, bbox
      ) values (
        v_extraction_id, v_doc, v_ws,
        (v_line->>'line_index')::integer,
        v_line->>'description',
        nullif(v_line->>'quantity', '')::numeric,
        nullif(v_line->>'unit', ''),
        nullif(v_line->>'unit_price_minor', '')::bigint,
        nullif(v_line->>'currency', ''),
        nullif(v_line->>'tax_rate', '')::numeric,
        nullif(v_line->>'tax_amount_minor', '')::bigint,
        nullif(v_line->>'discount_minor', '')::bigint,
        nullif(v_line->>'line_total_minor', '')::bigint,
        nullif(v_line->>'confidence', '')::numeric,
        nullif(v_line->>'source_page', '')::integer,
        v_line->'bbox'
      )
      on conflict (extraction_id, line_index) do nothing;
    end loop;

    -- CHANGED (Phase 3): land at 'validating', not 'needs_review'.
    update public.bill_documents
    set doc_class = nullif(payload->>'doc_class', ''),
        status = 'validating',
        processing_error = null
    where id = v_doc;

    perform public.record_bill_event(
      v_doc, v_ws, 'provider', 'classification_completed', v_from, null, 'ok',
      jsonb_build_object('doc_class', payload->>'doc_class'),
      nullif(payload->>'request_id', ''), nullif(payload->>'provider', ''),
      nullif(payload->>'model', '')
    );
    perform public.record_bill_event(
      v_doc, v_ws, 'provider', 'extraction_completed', v_from, null, 'ok', null,
      nullif(payload->>'request_id', ''), nullif(payload->>'provider', ''),
      nullif(payload->>'model', '')
    );
    -- CHANGED (Phase 3): -> 'validating'; the validation run then moves it
    -- to 'needs_review'.
    perform public.record_bill_event(
      v_doc, v_ws, 'system', 'status_changed', v_from, 'validating', 'ok'
    );

    -- CHANGED (Phase 3): return status 'validating'.
    return jsonb_build_object('ok', true, 'extraction_id', v_extraction_id, 'status', 'validating');
  else
    update public.bill_documents set status = 'processing_failed', processing_error = payload->'error'
    where id = v_doc;
    perform public.record_bill_event(
      v_doc, v_ws, 'provider', 'extraction_failed', v_from, 'processing_failed', 'failed',
      payload->'error', nullif(payload->>'request_id', ''),
      nullif(payload->>'provider', ''), nullif(payload->>'model', '')
    );
    return jsonb_build_object('ok', true, 'extraction_id', v_extraction_id, 'status', 'processing_failed');
  end if;
end;
$$;

comment on function public.record_bill_extraction is
  'Worker-only (service_role) write point for a completed classify+extract run: inserts the run + fields + line items, flips is_current, stamps bill_documents.doc_class, advances the lifecycle to ''validating'', and writes processing-journal rows. The worker then runs the deterministic validation engine and calls record_bill_validation to reach ''needs_review''. Not authenticated-callable.';

-- ===========================================================================
-- RLS
-- ===========================================================================

alter table public.bill_validations enable row level security;
alter table public.bill_validation_findings enable row level security;

create policy bill_validations_select_member on public.bill_validations
  for select to authenticated
  using (public.is_workspace_member(workspace_id));
create policy bill_validation_findings_select_member on public.bill_validation_findings
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

revoke all on public.bill_validations, public.bill_validation_findings from anon;

grant select on public.bill_validations to authenticated;
grant select on public.bill_validation_findings to authenticated;

grant select, insert, update, delete on public.bill_validations to service_role;
grant select, insert, update, delete on public.bill_validation_findings to service_role;
