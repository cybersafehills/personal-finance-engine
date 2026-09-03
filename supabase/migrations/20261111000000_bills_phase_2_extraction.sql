-- Bills & Expenses - Phase 2: document classification + structured field
-- extraction.
--
-- Design of record: docs/bills-and-expenses-design.md (Phase 2 row).
-- Master prompt §7 (classification), §8 (structured data extraction),
-- §17 (AI/extraction provider architecture), §18 (background processing).
--
-- Purely additive. Three new tables, two new SECURITY DEFINER RPCs, no
-- change to any existing object except that Phase 2 finally exercises the
-- classifying/extracting lifecycle hops the Phase 1 matrix already
-- declared (bill_document_transition_allowed is unchanged). With
-- BILLS_EXTRACTION_ENABLED unset (its default), nothing calls any of
-- this - a Phase 1 upload still lands at status='stored' and stays there.
--
-- Conventions follow Phase 1 / Phase N-R: text + CHECK enum-likes, RLS
-- via is_workspace_member(), anon revoked, explicit GRANT EXECUTE,
-- SECURITY DEFINER + SET search_path = public, decimal-safe money in
-- integer minor units.
--
-- !! PRE-MERGE: run supabase/migrations/tests/run_migration_tests.sh
--    (PostgreSQL 17). The "Bills Phase 2" block added there covers the
--    is_current partial-unique guard, record_bill_extraction being
--    service_role-only, doc_class + lifecycle advancement, and
--    cross-workspace RLS isolation on the three new tables.

-- ===========================================================================
-- bill_extractions - one classify+extract run over a document. Multiple
-- rows per document are expected (a retry adds a run); exactly one is
-- is_current at a time (partial unique). Immutable enough to reconstruct
-- what the system produced at a given time (master prompt §15): provider,
-- model, ruleset_version and the raw model response reference are all
-- captured.
-- ===========================================================================

create table public.bill_extractions (
  id uuid primary key default gen_random_uuid(),
  bill_document_id uuid not null references public.bill_documents (id) on delete cascade,
  workspace_id uuid not null,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'succeeded', 'failed')),
  is_current boolean not null default false,

  -- Classification result (master prompt §7).
  doc_class text
    check (doc_class is null or doc_class in (
      'supplier_invoice', 'receipt', 'credit_note', 'quotation',
      'proforma', 'payment_confirmation', 'bank_or_momo_statement',
      'unsupported', 'unknown'
    )),
  doc_class_confidence numeric(5, 4)
    check (doc_class_confidence is null or (doc_class_confidence >= 0 and doc_class_confidence <= 1)),
  doc_class_signals jsonb,

  -- Provenance (master prompt §17).
  provider text,
  model text,
  ruleset_version text not null default 'bills-extract-v1',
  request_id text,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  usage jsonb,

  error jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),

  constraint bill_extractions_document_same_workspace
    foreign key (workspace_id, bill_document_id)
    references public.bill_documents (workspace_id, id)
);

comment on table public.bill_extractions is
  'One classify+extract run over a bill document (master prompt §7/§8/§17). Multiple runs per document (retries); exactly one is_current, enforced by bill_extractions_one_current. Advisory only - the deterministic validation engine (Phase 3) is authoritative.';

-- Exactly one current extraction per document.
create unique index bill_extractions_one_current
  on public.bill_extractions (bill_document_id)
  where is_current;
create index idx_bill_extractions_document
  on public.bill_extractions (bill_document_id, created_at desc);
create index idx_bill_extractions_workspace_status
  on public.bill_extractions (workspace_id, status);

-- ===========================================================================
-- bill_extracted_fields - one row per extracted field, keeping the raw
-- value, the normalized value, confidence, source location, and any user
-- correction side by side (master prompt §8: "For every extracted field,
-- preserve ..."). Money is stored as integer minor units in
-- normalized_value with the currency alongside; never binary float.
-- ===========================================================================

create table public.bill_extracted_fields (
  id uuid primary key default gen_random_uuid(),
  extraction_id uuid not null references public.bill_extractions (id) on delete cascade,
  bill_document_id uuid not null references public.bill_documents (id) on delete cascade,
  workspace_id uuid not null,

  field_key text not null check (length(trim(both from field_key)) > 0),
  value_type text not null
    check (value_type in ('string', 'date', 'money_minor', 'decimal', 'integer')),
  raw_value text,
  normalized_value text,
  currency char(3) check (currency is null or currency = upper(currency)),
  confidence numeric(5, 4)
    check (confidence is null or (confidence >= 0 and confidence <= 1)),
  source_page integer check (source_page is null or source_page > 0),
  bbox jsonb,
  method text,

  -- User correction (Phase 7 writes these; declared now so that phase is
  -- additive). The original raw/normalized values above are never
  -- overwritten.
  user_corrected_value text,
  corrected_by uuid references auth.users (id) on delete set null,
  corrected_at timestamptz,

  created_at timestamptz not null default now(),

  constraint bill_extracted_fields_document_same_workspace
    foreign key (workspace_id, bill_document_id)
    references public.bill_documents (workspace_id, id),
  constraint bill_extracted_fields_unique_key unique (extraction_id, field_key)
);

comment on table public.bill_extracted_fields is
  'Per-field extraction output: raw + normalized value, confidence, source page/bbox, and any later user correction, side by side (master prompt §8). Money is integer minor units in normalized_value with currency alongside - never float.';

create index idx_bill_extracted_fields_extraction
  on public.bill_extracted_fields (extraction_id);
create index idx_bill_extracted_fields_document
  on public.bill_extracted_fields (bill_document_id);

-- ===========================================================================
-- bill_line_items - extracted invoice/receipt lines. All money columns
-- are integer minor units of `currency`.
-- ===========================================================================

create table public.bill_line_items (
  id uuid primary key default gen_random_uuid(),
  extraction_id uuid not null references public.bill_extractions (id) on delete cascade,
  bill_document_id uuid not null references public.bill_documents (id) on delete cascade,
  workspace_id uuid not null,

  line_index integer not null check (line_index >= 0),
  description text,
  quantity numeric,
  unit text,
  unit_price_minor bigint,
  currency char(3) check (currency is null or currency = upper(currency)),
  tax_rate numeric check (tax_rate is null or tax_rate >= 0),
  tax_amount_minor bigint,
  discount_minor bigint,
  line_total_minor bigint,
  confidence numeric(5, 4)
    check (confidence is null or (confidence >= 0 and confidence <= 1)),
  source_page integer check (source_page is null or source_page > 0),
  bbox jsonb,
  created_at timestamptz not null default now(),

  constraint bill_line_items_document_same_workspace
    foreign key (workspace_id, bill_document_id)
    references public.bill_documents (workspace_id, id),
  constraint bill_line_items_unique_index unique (extraction_id, line_index)
);

comment on table public.bill_line_items is
  'Extracted invoice/receipt line items. Every *_minor column is integer minor units of `currency` (master prompt §8: decimal-safe, never float).';

create index idx_bill_line_items_extraction
  on public.bill_line_items (extraction_id);
create index idx_bill_line_items_document
  on public.bill_line_items (bill_document_id);

-- ===========================================================================
-- record_bill_extraction - the worker's single write point for a
-- completed run. SERVICE_ROLE ONLY: the extraction worker
-- (web/lib/bills/worker.ts, invoked by the cron route) runs with the
-- service-role client; an authenticated user never records an extraction
-- directly. Atomically: inserts the run + its fields + line items, flips
-- is_current, stamps bill_documents.doc_class, advances the lifecycle
-- (extracting -> validating -> needs_review, or -> processing_failed),
-- and writes processing-journal rows.
--
-- payload shape:
--   { bill_document_id, workspace_id, status:'succeeded'|'failed',
--     provider, model, ruleset_version, request_id, duration_ms, usage,
--     doc_class, doc_class_confidence, doc_class_signals, error,
--     fields:[ {field_key, value_type, raw_value, normalized_value,
--              currency, confidence, source_page, bbox, method} ],
--     line_items:[ {line_index, description, quantity, unit,
--                  unit_price_minor, currency, tax_rate, tax_amount_minor,
--                  discount_minor, line_total_minor, confidence,
--                  source_page, bbox} ] }
-- ===========================================================================

create function public.record_bill_extraction(payload jsonb)
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

  -- New runs supersede the previous current one.
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

    update public.bill_documents
    set doc_class = nullif(payload->>'doc_class', ''),
        status = 'needs_review',
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
    -- Straight to needs_review: Phase 3's deterministic validation engine
    -- will insert the real 'validating' pass ahead of this when it ships.
    perform public.record_bill_event(
      v_doc, v_ws, 'system', 'status_changed', v_from, 'needs_review', 'ok'
    );

    return jsonb_build_object('ok', true, 'extraction_id', v_extraction_id, 'status', 'needs_review');
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
  'Worker-only (service_role) write point for a completed classify+extract run: inserts the run + fields + line items, flips is_current, stamps bill_documents.doc_class, advances the lifecycle, and writes processing-journal rows. Not authenticated-callable.';

revoke all on function public.record_bill_extraction(jsonb) from public;
grant execute on function public.record_bill_extraction(jsonb) to service_role;

-- ===========================================================================
-- system_transition_bill_document - the worker's lifecycle-advance path
-- for the machine hops (queued -> scanning -> classifying -> extracting).
-- SERVICE_ROLE ONLY - there is no user actor and no capability check;
-- the EXECUTE grant is the boundary (mirrors Phase O's
-- system_transition_payment_intent). Matrix-validated; a matrix-invalid
-- or same-state call is a no-op { ok:true, changed:false } so a re-run
-- of a partially-processed tick is safe.
-- ===========================================================================

create function public.system_transition_bill_document(
  p_id uuid,
  p_to_state text,
  p_reason jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws uuid;
  v_from text;
begin
  select workspace_id, status into v_ws, v_from
  from public.bill_documents where id = p_id for update;
  if v_ws is null then
    raise exception 'not_found' using errcode = 'no_data_found';
  end if;

  if v_from = p_to_state then
    return jsonb_build_object('ok', true, 'changed', false, 'status', v_from);
  end if;
  if not public.bill_document_transition_allowed(v_from, p_to_state) then
    return jsonb_build_object('ok', false, 'error', 'invalid_transition', 'from', v_from, 'to', p_to_state);
  end if;

  update public.bill_documents set status = p_to_state where id = p_id;
  perform public.record_bill_event(
    p_id, v_ws, 'system', 'status_changed', v_from, p_to_state, 'ok', p_reason
  );
  return jsonb_build_object('ok', true, 'changed', true, 'status', p_to_state);
end;
$$;

comment on function public.system_transition_bill_document is
  'Worker-only (service_role) lifecycle advance for the machine hops. No capability check - the EXECUTE grant is the boundary. Matrix-validated; same-state / invalid calls no-op.';

revoke all on function public.system_transition_bill_document(uuid, text, jsonb) from public;
grant execute on function public.system_transition_bill_document(uuid, text, jsonb) to service_role;

-- ===========================================================================
-- retry_bill_extraction - an authorised reviewer re-queues a failed (or
-- stuck) document. bill.review-gated. Moves the document back to 'queued'
-- so the next worker tick picks it up.
-- ===========================================================================

create function public.retry_bill_extraction(p_bill_document_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws uuid;
  v_from text;
begin
  select workspace_id, status into v_ws, v_from
  from public.bill_documents where id = p_bill_document_id for update;
  if v_ws is null then
    raise exception 'not_found' using errcode = 'no_data_found';
  end if;
  if not public.is_workspace_member(v_ws, 'member') then
    raise exception 'not_authorized' using errcode = 'insufficient_privilege';
  end if;
  if not public.has_space_capability(v_ws, 'bill.review') then
    raise exception 'not_authorized: bill.review required' using errcode = 'insufficient_privilege';
  end if;

  if not public.bill_document_transition_allowed(v_from, 'queued') then
    return jsonb_build_object('ok', false, 'error', 'not_retryable', 'from', v_from);
  end if;

  update public.bill_documents set status = 'queued', processing_error = null
  where id = p_bill_document_id;
  perform public.record_bill_event(
    p_bill_document_id, v_ws, 'user', 'processing_retried', v_from, 'queued', 'ok'
  );
  return jsonb_build_object('ok', true, 'status', 'queued');
end;
$$;

comment on function public.retry_bill_extraction is
  'Re-queues a failed/stuck bill document for extraction. Membership + bill.review gated. Returns { ok:false, error:not_retryable } when the current state has no path back to queued.';

revoke all on function public.retry_bill_extraction(uuid) from public;
grant execute on function public.retry_bill_extraction(uuid) to authenticated, service_role;

-- ===========================================================================
-- RLS
-- ===========================================================================

alter table public.bill_extractions enable row level security;
alter table public.bill_extracted_fields enable row level security;
alter table public.bill_line_items enable row level security;

create policy bill_extractions_select_member on public.bill_extractions
  for select to authenticated
  using (public.is_workspace_member(workspace_id));
create policy bill_extracted_fields_select_member on public.bill_extracted_fields
  for select to authenticated
  using (public.is_workspace_member(workspace_id));
create policy bill_line_items_select_member on public.bill_line_items
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

revoke all on public.bill_extractions, public.bill_extracted_fields,
  public.bill_line_items from anon;

grant select on public.bill_extractions to authenticated;
grant select on public.bill_extracted_fields to authenticated;
grant select on public.bill_line_items to authenticated;

grant select, insert, update, delete on public.bill_extractions to service_role;
grant select, insert, update, delete on public.bill_extracted_fields to service_role;
grant select, insert, update, delete on public.bill_line_items to service_role;
