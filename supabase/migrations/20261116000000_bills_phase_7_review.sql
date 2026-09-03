-- Bills & Expenses - Phase 7: human review workspace - field corrections
-- with provenance, stale-validation prevention, and comments.
--
-- Design of record: docs/bills-and-expenses-design.md (Phase 7 row).
-- Master prompt §13 (review workspace), §21 (corrected-value provenance,
-- "prevent stale validation results from being approved").
--
-- What this adds:
--   * correct_bill_field - a bill.review holder edits an extracted field.
--     The raw + model-normalised values are NEVER overwritten; the
--     correction lands in user_corrected_value / corrected_by /
--     corrected_at (columns declared back in Phase 2). Each correction
--     bumps bill_documents.review_revision.
--   * record_bill_validation re-issued to stamp the document's
--     review_revision onto the validation run.
--   * approve_bill re-issued with a stale_validation guard: the current
--     validation must have run against the current review_revision.
--   * bill_comments + add_bill_comment - internal review notes.
--
-- Purely additive except two CREATE OR REPLACE re-issues (grants
-- preserved). transactions is untouched.
--
-- !! PRE-MERGE: run supabase/migrations/tests/run_migration_tests.sh
--    (PostgreSQL 17). The "Bills Phase 7" block covers correct_bill_field
--    provenance + revision bump, the stale-validation approve guard and
--    its clearance by a re-validation, add_bill_comment being
--    bill.review-gated, and cross-workspace RLS on bill_comments.

-- ===========================================================================
-- review_revision - bumped on every field correction. A validation run
-- records which revision it saw; approve_bill refuses to act on a
-- validation that predates the latest correction.
-- ===========================================================================

alter table public.bill_documents
  add column review_revision integer not null default 0;
alter table public.bill_validations
  add column review_revision integer not null default 0;

comment on column public.bill_documents.review_revision is
  'Incremented by correct_bill_field on every extracted-field correction. approve_bill requires the current validation run to have seen this exact revision (master prompt §21: no approval on stale validation).';

-- ===========================================================================
-- bill_comments - internal review notes on a document. Append-only:
-- no UPDATE/DELETE grant; INSERT only via add_bill_comment.
-- ===========================================================================

create table public.bill_comments (
  id uuid primary key default gen_random_uuid(),
  bill_document_id uuid not null references public.bill_documents (id) on delete cascade,
  workspace_id uuid not null,
  author_id uuid references auth.users (id) on delete set null,
  body text not null check (length(trim(both from body)) > 0 and length(body) <= 4000),
  created_at timestamptz not null default now(),

  constraint bill_comments_doc_same_workspace
    foreign key (workspace_id, bill_document_id)
    references public.bill_documents (workspace_id, id)
);

create index idx_bill_comments_document
  on public.bill_comments (bill_document_id, created_at);

-- ===========================================================================
-- correct_bill_field - a bill.review holder overrides one extracted field.
-- Operates on the document's CURRENT extraction. The raw + model
-- normalized values are preserved; only user_corrected_value is written.
-- Passing an empty value clears the correction. Bumps review_revision.
-- ===========================================================================

create function public.correct_bill_field(
  p_bill_document_id uuid,
  p_field_key text,
  p_value text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws uuid;
  v_ext uuid;
  v_clear boolean := (nullif(trim(both from coalesce(p_value, '')), '') is null);
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

  select id into v_ext from public.bill_extractions
  where bill_document_id = p_bill_document_id and is_current;
  if v_ext is null then
    return jsonb_build_object('ok', false, 'error', 'no_extraction');
  end if;

  update public.bill_extracted_fields
  set user_corrected_value = case when v_clear then null else trim(both from p_value) end,
      corrected_by = case when v_clear then null else auth.uid() end,
      corrected_at = case when v_clear then null else now() end
  where extraction_id = v_ext and field_key = p_field_key;

  if not found then
    -- The model did not return this field at all; record the correction
    -- as a new user-sourced field row so it is still captured.
    if not v_clear then
      insert into public.bill_extracted_fields (
        extraction_id, bill_document_id, workspace_id, field_key, value_type,
        raw_value, normalized_value, user_corrected_value, corrected_by, corrected_at, method
      ) values (
        v_ext, p_bill_document_id, v_ws, p_field_key, 'string',
        null, null, trim(both from p_value), auth.uid(), now(), 'user'
      )
      on conflict (extraction_id, field_key) do update
        set user_corrected_value = excluded.user_corrected_value,
            corrected_by = excluded.corrected_by,
            corrected_at = excluded.corrected_at;
    end if;
  end if;

  update public.bill_documents
  set review_revision = review_revision + 1
  where id = p_bill_document_id;

  perform public.record_bill_event(
    p_bill_document_id, v_ws, 'user', 'field_corrected', null, null, 'ok',
    jsonb_build_object('field_key', p_field_key, 'cleared', v_clear)
  );

  return jsonb_build_object('ok', true, 'cleared', v_clear);
end;
$$;

comment on function public.correct_bill_field is
  'bill.review-gated. Writes user_corrected_value (raw + model-normalised values preserved) on the current extraction''s field, or clears it for an empty value. Bumps bill_documents.review_revision so a stale validation can''t be approved.';

revoke all on function public.correct_bill_field(uuid, text, text) from public;
grant execute on function public.correct_bill_field(uuid, text, text) to authenticated;

-- ===========================================================================
-- add_bill_comment - a member with bill.review adds an internal note.
-- ===========================================================================

create function public.add_bill_comment(p_bill_document_id uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws uuid;
  v_id uuid;
begin
  select workspace_id into v_ws from public.bill_documents where id = p_bill_document_id;
  if v_ws is null then
    raise exception 'not_found' using errcode = 'no_data_found';
  end if;
  if not public.is_workspace_member(v_ws, 'member') then
    raise exception 'not_authorized' using errcode = 'insufficient_privilege';
  end if;
  if not public.has_space_capability(v_ws, 'bill.review') then
    raise exception 'not_authorized: bill.review required' using errcode = 'insufficient_privilege';
  end if;
  if length(trim(both from coalesce(p_body, ''))) = 0 then
    raise exception 'empty_comment' using errcode = 'check_violation';
  end if;

  insert into public.bill_comments (bill_document_id, workspace_id, author_id, body)
  values (p_bill_document_id, v_ws, auth.uid(), left(trim(both from p_body), 4000))
  returning id into v_id;

  perform public.record_bill_event(
    p_bill_document_id, v_ws, 'user', 'draft_saved', null, null, 'ok',
    jsonb_build_object('comment_id', v_id)
  );
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

revoke all on function public.add_bill_comment(uuid, text) from public;
grant execute on function public.add_bill_comment(uuid, text) to authenticated;

-- ===========================================================================
-- record_bill_validation - re-issued to stamp the document's current
-- review_revision onto the run. Byte-identical to the Phase 3 definition
-- except the two marked lines.
-- ===========================================================================

create or replace function public.record_bill_validation(payload jsonb)
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
  v_rev integer;
  v_validation_id uuid;
  v_finding jsonb;
  v_blocking int := 0;
  v_warning int := 0;
  v_info int := 0;
  v_sev text;
begin
  select status, review_revision into v_from, v_rev
  from public.bill_documents where id = v_doc and workspace_id = v_ws for update;
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
    ruleset_version, blocking_count, warning_count, info_count, error, review_revision
  ) values (
    v_doc, v_ws,
    nullif(payload->>'extraction_id', '')::uuid,
    v_status, (v_status = 'succeeded'),
    coalesce(nullif(payload->>'ruleset_version', ''), 'bills-validate-v1'),
    v_blocking, v_warning, v_info,
    payload->'error',
    coalesce(v_rev, 0)   -- CHANGED (Phase 7): stamp the review revision
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

-- ===========================================================================
-- approve_bill - re-issued with a stale_validation guard. Byte-identical
-- to the Phase 6 definition except the marked block.
-- ===========================================================================

create or replace function public.approve_bill(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc uuid := (payload->>'bill_document_id')::uuid;
  v_ws uuid;
  v_status text;
  v_created_by uuid;
  v_rev integer;
  v_ext uuid;
  v_bill_id uuid;
  v_existing uuid;
  v_currency text;
  v_total bigint;
  v_subtotal bigint;
  v_tax bigint;
  v_issue date;
  v_due date;
  v_supplier uuid;
  v_members int;
  v_val_rev integer;
begin
  select workspace_id, status, created_by, supplier_id, review_revision
    into v_ws, v_status, v_created_by, v_supplier, v_rev
  from public.bill_documents where id = v_doc for update;
  if v_ws is null then
    raise exception 'not_found' using errcode = 'no_data_found';
  end if;
  if not public.is_workspace_member(v_ws, 'member') then
    raise exception 'not_authorized' using errcode = 'insufficient_privilege';
  end if;
  if not public.has_space_capability(v_ws, 'bill.approve') then
    raise exception 'not_authorized: bill.approve required' using errcode = 'insufficient_privilege';
  end if;

  select id into v_existing from public.bills where bill_document_id = v_doc;
  if v_existing is not null then
    return jsonb_build_object('ok', true, 'bill_id', v_existing, 'already', true);
  end if;

  if v_status not in ('needs_review', 'under_review') then
    return jsonb_build_object('ok', false, 'error', 'not_reviewable', 'status', v_status);
  end if;

  -- No blocking validation finding.
  if exists (
    select 1
    from public.bill_validations v
    join public.bill_validation_findings f on f.validation_id = v.id
    where v.bill_document_id = v_doc and v.is_current and f.blocks_approval
  ) then
    return jsonb_build_object('ok', false, 'error', 'blocking_findings');
  end if;

  -- NEW (Phase 7): the current validation must have seen the current
  -- review_revision - no approving on stale checks after a correction.
  select review_revision into v_val_rev
  from public.bill_validations where bill_document_id = v_doc and is_current;
  if v_val_rev is null or v_val_rev is distinct from coalesce(v_rev, 0) then
    return jsonb_build_object('ok', false, 'error', 'stale_validation');
  end if;

  -- No unresolved likely-duplicate.
  if exists (
    select 1 from public.bill_duplicate_candidates d
    where d.bill_document_id = v_doc and d.is_current
      and d.resolution = 'unresolved' and d.relation in ('exact', 'probable')
  ) then
    return jsonb_build_object('ok', false, 'error', 'unresolved_duplicate');
  end if;

  select count(*) into v_members from public.workspace_memberships
  where workspace_id = v_ws and status = 'active';
  if v_created_by = auth.uid() and v_members > 1 then
    return jsonb_build_object('ok', false, 'error', 'self_approval_forbidden');
  end if;

  select id into v_ext from public.bill_extractions
  where bill_document_id = v_doc and is_current;

  -- Prefer a user correction over the model's normalised value.
  select
    (max(coalesce(user_corrected_value, normalized_value, raw_value)) filter (where field_key = 'currency')),
    (max(coalesce(user_corrected_value, normalized_value)) filter (where field_key = 'total'))::bigint,
    (max(coalesce(user_corrected_value, normalized_value)) filter (where field_key = 'subtotal'))::bigint,
    (max(coalesce(user_corrected_value, normalized_value)) filter (where field_key = 'tax_amount'))::bigint,
    (max(coalesce(user_corrected_value, normalized_value)) filter (where field_key = 'issue_date' and coalesce(user_corrected_value, normalized_value) ~ '^\d{4}-\d{2}-\d{2}$'))::date,
    (max(coalesce(user_corrected_value, normalized_value)) filter (where field_key = 'due_date' and coalesce(user_corrected_value, normalized_value) ~ '^\d{4}-\d{2}-\d{2}$'))::date
    into v_currency, v_total, v_subtotal, v_tax, v_issue, v_due
  from public.bill_extracted_fields
  where extraction_id = v_ext;

  if v_currency is null or v_total is null then
    return jsonb_build_object('ok', false, 'error', 'missing_currency_or_total');
  end if;

  insert into public.bills (
    workspace_id, bill_document_id, supplier_id, doc_class, currency,
    total_minor, subtotal_minor, tax_minor, issue_date, due_date,
    category, budget_id, notes, approved_by
  ) values (
    v_ws, v_doc, v_supplier,
    (select doc_class from public.bill_documents where id = v_doc),
    upper(v_currency), v_total, v_subtotal, v_tax, v_issue, v_due,
    nullif(payload->>'category', ''),
    nullif(payload->>'budget_id', '')::uuid,
    nullif(payload->>'notes', ''),
    auth.uid()
  )
  returning id into v_bill_id;

  update public.bill_documents set status = 'approved' where id = v_doc;
  perform public.record_bill_event(v_doc, v_ws, 'user', 'approved', v_status, 'approved', 'ok');
  perform public.record_space_audit_event(
    v_ws, 'bill.approved', 'bill_document', v_doc,
    jsonb_build_object('status', v_status),
    jsonb_build_object('bill_id', v_bill_id, 'total_minor', v_total, 'currency', upper(v_currency))
  );

  return jsonb_build_object('ok', true, 'bill_id', v_bill_id);
end;
$$;

-- ===========================================================================
-- RLS
-- ===========================================================================

alter table public.bill_comments enable row level security;

create policy bill_comments_select_member on public.bill_comments
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

revoke all on public.bill_comments from anon;
grant select on public.bill_comments to authenticated;
grant select, insert, update, delete on public.bill_comments to service_role;
