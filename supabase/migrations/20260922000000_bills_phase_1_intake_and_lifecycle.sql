-- Bills & Expenses - Phase 1: schema, storage, secure intake, original
-- preservation, an explicit server-enforced document lifecycle, and an
-- append-only processing journal.
--
-- Design of record: docs/bills-and-expenses-design.md (Phase 1 row).
-- Master prompt: "OneLedger Invoice and Expense Processor" - this
-- migration covers §4 (lifecycle), §5 (intake security - the DB half),
-- §6 (original-document preservation), §14 (permissions), §15 (data
-- model), §16 (audit / processing journal). Classification, extraction,
-- validation, duplicate scoring, supplier resolution, transaction
-- matching and posting are LATER phases this schema is deliberately
-- shaped for - none of their tables exist yet.
--
-- Purely additive. Four new tables, one new immutable helper, four new
-- SECURITY DEFINER RPCs, two private Storage buckets, and a
-- CREATE OR REPLACE of three existing Spaces authz functions
-- (space_role_has_capability + grant/revoke_space_capability) that only
-- widens their capability allowlist - no existing row is modified, no
-- column is retyped or dropped, no existing behaviour changes. With the
-- BILLS_ENABLED flag unset (its default), nothing in the application
-- calls any of this.
--
-- Conventions follow Phase N/Q/R exactly: text + CHECK enum-likes, RLS
-- via is_workspace_member(), capability checks via has_space_capability(),
-- anon revoked, explicit GRANT EXECUTE per function, SECURITY DEFINER +
-- SET search_path = public for every RPC, set_updated_at() trigger on
-- mutable rows, a <table>_workspace_id_id_unique composite-FK target.
--
-- !! PRE-MERGE: run supabase/migrations/tests/run_migration_tests.sh
--    (needs PostgreSQL 17 - see supabase/config.toml major_version). The
--    "Bills Phase 1" assertion block added to that script covers the
--    lifecycle CHECK, the per-workspace checksum uniqueness guard, the
--    transition matrix, record_bill_event lockdown, and cross-workspace
--    RLS isolation. The harness already mocks the storage.buckets table.

-- ===========================================================================
-- bill_documents - one uploaded financial document (invoice / receipt /
-- ...), its immutable stored original's metadata, and its lifecycle
-- state. The file BYTES live in the private "bill-documents" Storage
-- bucket at storage_key; this row is the canonical record and the RLS
-- boundary. A processing failure never deletes this row - it moves
-- status to 'processing_failed' and records why in processing_error.
-- ===========================================================================

create table public.bill_documents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null,

  -- How the document arrived. Only manual upload exists in Phase 1; the
  -- other values are declared now so later intake channels (master prompt
  -- §3) slot in without a CHECK rewrite, exactly as transactions.source
  -- and payment_intents.source were.
  intake_channel text not null default 'manual_upload'
    check (intake_channel in (
      'manual_upload', 'email', 'api', 'mobile_capture', 'bulk',
      'transaction_attachment'
    )),

  -- The persisted lifecycle (master prompt §4). Transitions are enforced
  -- server-side by transition_bill_document(); a client can never place a
  -- row into an arbitrary state.
  status text not null default 'received'
    check (status in (
      'uploading', 'received', 'stored', 'queued', 'scanning',
      'classifying', 'extracting', 'validating', 'needs_review',
      'under_review', 'awaiting_clarification', 'approved', 'rejected',
      'posting', 'posted', 'matched', 'processing_failed', 'archived'
    )),

  -- Set by Phase 2 classification; NULL here means "not classified yet",
  -- never "unknown" (which is an explicit value).
  doc_class text
    check (doc_class is null or doc_class in (
      'supplier_invoice', 'receipt', 'credit_note', 'quotation',
      'proforma', 'payment_confirmation', 'bank_or_momo_statement',
      'unsupported', 'unknown'
    )),

  -- ----- immutable original (master prompt §6) --------------------------
  original_filename text not null
    check (length(trim(both from original_filename)) > 0),
  -- Filename after sanitisation (path separators / control chars stripped,
  -- length-capped) - what is safe to show and to log.
  sanitized_filename text not null
    check (length(trim(both from sanitized_filename)) > 0),
  -- Generated, opaque, tenant-prefixed object key in "bill-documents".
  -- Never contains a user-supplied string. Unique per workspace.
  storage_key text not null,
  mime_type text not null
    check (mime_type in (
      'application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif'
    )),
  byte_size bigint not null check (byte_size > 0),
  page_count integer check (page_count is null or page_count > 0),
  -- Lowercase hex SHA-256 of the exact bytes received.
  checksum_sha256 text not null check (checksum_sha256 ~ '^[0-9a-f]{64}$'),

  -- Malware scanning is a documented integration point (master prompt §5)
  -- - no scanning infrastructure exists in this codebase yet, so Phase 1
  -- ships 'skipped' and the design doc records this as accepted debt for
  -- a pre-GA decision.
  security_scan_status text not null default 'skipped'
    check (security_scan_status in (
      'skipped', 'pending', 'clean', 'flagged', 'failed'
    )),

  -- Retention model (master prompt §6). 'deletion_restricted' is for
  -- documents under a financial-retention obligation: they may be
  -- archived, never hard-deleted.
  retention_status text not null default 'active'
    check (retention_status in ('active', 'archived', 'deletion_restricted')),

  -- Structured, non-sensitive reason a processing step failed. Never
  -- holds document contents.
  processing_error jsonb,
  metadata jsonb not null default '{}'::jsonb,

  uploaded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint bill_documents_workspace_id_id_unique unique (workspace_id, id),
  -- Exact-duplicate-file guard at the DB layer, from day one (master
  -- prompt §10). A re-upload of byte-identical content is surfaced to the
  -- user as a duplicate (with a link to the first), never silently stored
  -- twice and never a raw constraint error - create_bill_document()
  -- catches this and returns a structured result.
  constraint bill_documents_checksum_unique unique (workspace_id, checksum_sha256),
  constraint bill_documents_storage_key_unique unique (workspace_id, storage_key)
);

comment on table public.bill_documents is
  'One uploaded financial document + its immutable original''s metadata + its lifecycle state. File bytes live in the private bill-documents Storage bucket at storage_key. status is governed by transition_bill_document(). A processing failure moves status to processing_failed and never deletes the row or the original (master prompt §4/§6).';
comment on column public.bill_documents.storage_key is
  'Generated opaque tenant-prefixed key in the private "bill-documents" bucket. Never a public URL, never contains a user-supplied string. Downloads go through a short-lived signed URL issued by app/api/bills/[id]/original after an RLS ownership + bill.download_original capability check.';
comment on column public.bill_documents.checksum_sha256 is
  'Lowercase hex SHA-256 of the exact bytes received. bill_documents_checksum_unique makes a byte-identical re-upload a surfaced duplicate, not a second row.';

create trigger set_bill_documents_updated_at
  before update on public.bill_documents
  for each row execute function public.set_updated_at();

create index idx_bill_documents_workspace_status
  on public.bill_documents (workspace_id, status, uploaded_at desc);
create index idx_bill_documents_workspace_checksum
  on public.bill_documents (workspace_id, checksum_sha256);
create index idx_bill_documents_workspace_creator
  on public.bill_documents (workspace_id, created_by);

-- ===========================================================================
-- bill_document_artifacts - the immutable original plus every derived
-- file (previews, thumbnails, OCR text, extracted JSON, ...). Modelled on
-- report_artifacts (Phase K). The 'original' row is written once, in the
-- same transaction as its bill_documents row, and is protected against
-- UPDATE/DELETE by a trigger (master prompt §6: "Never overwrite the
-- original ... with a ... derivative"). Derived rows arrive in Phase 2+.
-- ===========================================================================

create table public.bill_document_artifacts (
  id uuid primary key default gen_random_uuid(),
  bill_document_id uuid not null references public.bill_documents (id) on delete cascade,
  workspace_id uuid not null,
  kind text not null
    check (kind in (
      'original', 'preview_image', 'thumbnail', 'ocr_text',
      'normalized_pdf', 'annotated_preview', 'extracted_json',
      'model_response', 'export'
    )),
  bucket text not null
    check (bucket in ('bill-documents', 'bill-derivatives')),
  storage_path text not null,
  mime_type text not null,
  byte_size bigint not null check (byte_size > 0),
  checksum_sha256 text
    check (checksum_sha256 is null or checksum_sha256 ~ '^[0-9a-f]{64}$'),
  page_number integer check (page_number is null or page_number > 0),
  created_at timestamptz not null default now(),

  -- One artifact per (document, kind, page). NULLS NOT DISTINCT (PG15+;
  -- the linked project is PG17) so the single-file kinds (original,
  -- extracted_json, ...) with page_number IS NULL are still unique - a
  -- plain UNIQUE would treat every NULL as distinct and allow a second
  -- 'original' row.
  constraint bill_document_artifacts_unique
    unique nulls not distinct (bill_document_id, kind, page_number),
  constraint bill_document_artifacts_document_same_workspace
    foreign key (workspace_id, bill_document_id)
    references public.bill_documents (workspace_id, id),
  -- The original always lives in the immutable bucket.
  constraint bill_document_artifacts_original_bucket
    check (kind <> 'original' or bucket = 'bill-documents')
);

comment on table public.bill_document_artifacts is
  'The immutable original (kind=original) plus every derived file for a bill document. Modelled on report_artifacts. The original row is write-once - enforce_bill_original_immutable() rejects UPDATE/DELETE of a kind=original row. No authenticated grants: browsers receive only short-lived signed URLs from the bills API routes.';

create index idx_bill_document_artifacts_document
  on public.bill_document_artifacts (bill_document_id, kind);

-- Hard stop against ever mutating or removing a stored original.
create function public.enforce_bill_original_immutable()
returns trigger
language plpgsql
as $$
begin
  if (tg_op = 'DELETE' and old.kind = 'original')
     or (tg_op = 'UPDATE' and old.kind = 'original') then
    raise exception
      'bill_original_immutable: a kind=original artifact cannot be % (master prompt §6)', lower(tg_op)
      using errcode = 'check_violation';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

comment on function public.enforce_bill_original_immutable is
  'Rejects UPDATE/DELETE of a bill_document_artifacts row with kind=original. The original is preserved exactly as received; only its parent bill_documents row being CASCADE-deleted (an authorised retention action) can remove it.';

-- Trigger function - never called directly (mirrors the Phase M/P/Q
-- trigger-function hardening).
revoke all on function public.enforce_bill_original_immutable() from public;

create trigger bill_document_artifacts_original_immutable
  before update or delete on public.bill_document_artifacts
  for each row execute function public.enforce_bill_original_immutable();

-- ===========================================================================
-- bill_processing_events - the append-only processing journal (master
-- prompt §16). Every material system and user action on a document lands
-- here. INSERT is only ever done by record_bill_event() (an internal
-- SECURITY DEFINER helper, no authenticated grant) or the service role;
-- there is no UPDATE/DELETE grant to anyone. Material USER actions are
-- ALSO written to the existing per-Space space_audit_events trail by the
-- RPCs below, so a Space owner/admin sees bill activity alongside every
-- other sensitive action.
-- ===========================================================================

create table public.bill_processing_events (
  id uuid primary key default gen_random_uuid(),
  bill_document_id uuid not null references public.bill_documents (id) on delete cascade,
  workspace_id uuid not null,
  actor_type text not null check (actor_type in ('user', 'system', 'provider', 'cron')),
  actor_user_id uuid references auth.users (id) on delete set null,
  -- Free text from a documented set (web/lib/bills/events.ts) rather than
  -- a CHECK, so a new Phase 2+ event type is a code change, not a
  -- migration. Never a raw document string.
  event_type text not null check (length(trim(both from event_type)) > 0),
  previous_state text,
  new_state text,
  correlation_id text,
  provider text,
  model_version text,
  outcome text check (outcome is null or outcome in ('ok', 'failed', 'skipped')),
  -- Structured, non-sensitive reason / detail. Document contents are
  -- never copied here (master prompt §16).
  reason jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),

  constraint bill_processing_events_document_same_workspace
    foreign key (workspace_id, bill_document_id)
    references public.bill_documents (workspace_id, id)
);

comment on table public.bill_processing_events is
  'Append-only processing journal for bill documents (master prompt §16). No UPDATE/DELETE grant to any role; INSERT only via record_bill_event() or the service role. Readable by workspace members holding bill.audit.view.';

create index idx_bill_processing_events_document
  on public.bill_processing_events (bill_document_id, created_at);

-- ===========================================================================
-- bill_processing_policies - per-workspace configuration (master prompt
-- §9/§14): supported currencies, expected tax rates, large-amount
-- threshold, required fields, duplicate/date tolerances, and the
-- (Phase 6+, dark) auto-approval switch. One row per workspace, created
-- lazily by get_or_create_bill_processing_policy(). Consumed by the
-- Phase 3 validation engine and the Phase 6 approval policy; created now
-- so those phases are purely additive.
-- ===========================================================================

create table public.bill_processing_policies (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  supported_currencies text[] not null default array['RWF', 'USD', 'EUR'],
  expected_tax_rates numeric[] not null default array[]::numeric[],
  large_amount_threshold_minor bigint
    check (large_amount_threshold_minor is null or large_amount_threshold_minor > 0),
  large_amount_currency char(3) not null default 'RWF'
    check (large_amount_currency = upper(large_amount_currency)),
  required_fields text[] not null
    default array['supplier', 'issue_date', 'total', 'currency'],
  duplicate_amount_tolerance_minor bigint not null default 0
    check (duplicate_amount_tolerance_minor >= 0),
  date_tolerance_days integer not null default 3
    check (date_tolerance_days >= 0),
  -- DARK in the first release (master prompt §2). Architected-for only;
  -- no code path reads this as "true" yet.
  auto_approval_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

comment on table public.bill_processing_policies is
  'Per-workspace Bills & Expenses configuration. auto_approval_enabled is DARK in the first release (master prompt §2) - architected-for, never honoured yet. Consumed by the Phase 3 validation engine and Phase 6 approval policy.';

create trigger set_bill_processing_policies_updated_at
  before update on public.bill_processing_policies
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- bill_document_transition_allowed - the lifecycle matrix, as a pure
-- IMMUTABLE function (same style as space_role_has_capability and
-- payment_intent_transition_allowed). Editing the lifecycle = editing
-- this one function. Phase 1 only needs the intake + manual review-less
-- path plus archive + failure; the classify/extract/validate hops are
-- listed so the Phase 2 worker is additive.
-- ===========================================================================

create function public.bill_document_transition_allowed(p_from text, p_to text)
returns boolean
language sql
immutable
as $$
  select case
    -- Any non-terminal state can fail or be archived.
    when p_to = 'processing_failed'
      then p_from not in ('posted', 'matched', 'rejected', 'archived')
    when p_to = 'archived'
      then p_from <> 'archived'
    -- A failed document can be retried back into the pipeline.
    when p_from = 'processing_failed' and p_to = 'queued' then true

    when p_from = 'uploading'     and p_to = 'received'       then true
    when p_from = 'received'      and p_to = 'stored'         then true
    when p_from = 'stored'        and p_to = 'queued'         then true
    when p_from = 'queued'        and p_to = 'scanning'       then true
    when p_from = 'scanning'      and p_to = 'classifying'    then true
    when p_from = 'classifying'   and p_to = 'extracting'     then true
    when p_from = 'extracting'    and p_to = 'validating'     then true
    when p_from = 'validating'    and p_to = 'needs_review'   then true
    -- Phase 1 (no AI): a freshly stored document goes straight to review.
    when p_from = 'stored'        and p_to = 'needs_review'   then true

    when p_from = 'needs_review'  and p_to = 'under_review'   then true
    when p_from = 'under_review'  and p_to = 'needs_review'   then true
    when p_from = 'under_review'  and p_to = 'awaiting_clarification' then true
    when p_from = 'awaiting_clarification' and p_to = 'under_review'  then true
    when p_from in ('needs_review', 'under_review') and p_to = 'approved' then true
    when p_from in ('needs_review', 'under_review') and p_to = 'rejected' then true
    when p_from = 'rejected'      and p_to = 'needs_review'   then true

    when p_from = 'approved'      and p_to = 'posting'        then true
    when p_from = 'posting'       and p_to = 'posted'         then true
    when p_from = 'posting'       and p_to = 'matched'        then true
    when p_from = 'approved'      and p_to = 'matched'        then true
    when p_from = 'posting'       and p_to = 'approved'       then true  -- posting failed, retry later

    else false
  end;
$$;

comment on function public.bill_document_transition_allowed is
  'The bill_documents lifecycle matrix. Pure/IMMUTABLE. True iff p_from -> p_to is a permitted transition. Any non-terminal state may go to processing_failed or archived; processing_failed may be retried to queued.';

-- ===========================================================================
-- record_bill_event - internal append-only-journal writer. Not
-- authenticated-callable (revoke all from public, no grant to
-- authenticated); invoked only from the SECURITY DEFINER RPCs below and
-- from Phase 2+ RPCs. Mirrors record_space_audit_event.
-- ===========================================================================

create function public.record_bill_event(
  p_bill_document_id uuid,
  p_workspace_id uuid,
  p_actor_type text,
  p_event_type text,
  p_previous_state text default null,
  p_new_state text default null,
  p_outcome text default null,
  p_reason jsonb default null,
  p_correlation_id text default null,
  p_provider text default null,
  p_model_version text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.bill_processing_events (
    bill_document_id, workspace_id, actor_type, actor_user_id, event_type,
    previous_state, new_state, outcome, reason, correlation_id, provider,
    model_version, metadata
  ) values (
    p_bill_document_id, p_workspace_id, p_actor_type,
    case when p_actor_type = 'user' then auth.uid() else null end,
    p_event_type, p_previous_state, p_new_state, p_outcome, p_reason,
    p_correlation_id, p_provider, p_model_version, coalesce(p_metadata, '{}'::jsonb)
  );
end;
$$;

comment on function public.record_bill_event is
  'Internal: appends one row to the append-only bill_processing_events journal. Not authenticated-callable - invoked only from other SECURITY DEFINER RPCs. actor_user_id is auth.uid() only for actor_type=user.';

revoke all on function public.record_bill_event(uuid, uuid, text, text, text, text, text, jsonb, text, text, text, jsonb) from public;

-- ===========================================================================
-- create_bill_document - records a just-uploaded document. The bytes are
-- ALREADY in the bill-documents bucket at storage_key (the server action
-- uploads them with the service-role client before calling this); this
-- RPC writes the canonical row + the immutable 'original' artifact row +
-- a processing event + a space audit event, all in one transaction.
--
-- Requires the caller to be a workspace member AND hold bill.upload. A
-- byte-identical re-upload (bill_documents_checksum_unique) returns a
-- structured { ok:false, error:'duplicate_document', existing_id } rather
-- than raising, so the caller can point the user at the first copy and
-- clean up the redundant object it just wrote.
-- ===========================================================================

create function public.create_bill_document(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws uuid := (payload->>'workspace_id')::uuid;
  v_id uuid;
  v_existing_id uuid;
begin
  if v_ws is null then
    raise exception 'invalid_payload: workspace_id required' using errcode = 'check_violation';
  end if;
  if not public.is_workspace_member(v_ws, 'member') then
    raise exception 'not_authorized: not a member of this workspace' using errcode = 'insufficient_privilege';
  end if;
  if not public.has_space_capability(v_ws, 'bill.upload') then
    raise exception 'not_authorized: bill.upload required' using errcode = 'insufficient_privilege';
  end if;

  begin
    insert into public.bill_documents (
      workspace_id, created_by, intake_channel, status,
      original_filename, sanitized_filename, storage_key, mime_type,
      byte_size, page_count, checksum_sha256, metadata
    ) values (
      v_ws, auth.uid(),
      coalesce(nullif(payload->>'intake_channel', ''), 'manual_upload'),
      'stored',
      payload->>'original_filename',
      payload->>'sanitized_filename',
      payload->>'storage_key',
      payload->>'mime_type',
      (payload->>'byte_size')::bigint,
      nullif(payload->>'page_count', '')::integer,
      payload->>'checksum_sha256',
      coalesce(payload->'metadata', '{}'::jsonb)
    )
    returning id into v_id;
  exception when unique_violation then
    select id into v_existing_id
    from public.bill_documents
    where workspace_id = v_ws
      and checksum_sha256 = payload->>'checksum_sha256';
    return jsonb_build_object(
      'ok', false, 'error', 'duplicate_document',
      'existing_id', v_existing_id
    );
  end;

  insert into public.bill_document_artifacts (
    bill_document_id, workspace_id, kind, bucket, storage_path,
    mime_type, byte_size, checksum_sha256, page_number
  ) values (
    v_id, v_ws, 'original', 'bill-documents', payload->>'storage_key',
    payload->>'mime_type', (payload->>'byte_size')::bigint,
    payload->>'checksum_sha256', null
  );

  perform public.record_bill_event(
    v_id, v_ws, 'user', 'document_received', null, 'stored', 'ok',
    jsonb_build_object('intake_channel', coalesce(nullif(payload->>'intake_channel', ''), 'manual_upload'))
  );

  perform public.record_space_audit_event(
    v_ws, 'bill.uploaded', 'bill_document', v_id,
    null,
    jsonb_build_object(
      'filename', payload->>'sanitized_filename',
      'mime_type', payload->>'mime_type',
      'byte_size', (payload->>'byte_size')::bigint
    )
  );

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

comment on function public.create_bill_document is
  'Records a just-uploaded bill document (bytes already in the bill-documents bucket at storage_key). Member + bill.upload gated. Writes the canonical row, the immutable original artifact, a processing event, and a space audit event. Returns {ok:false,error:duplicate_document,existing_id} for a byte-identical re-upload instead of raising.';

revoke all on function public.create_bill_document(jsonb) from public;
grant execute on function public.create_bill_document(jsonb) to authenticated, service_role;

-- ===========================================================================
-- transition_bill_document - the only way an authenticated caller moves a
-- document through its lifecycle. Membership + a capability keyed to the
-- target state, then the matrix, then the row update + a journal entry.
-- An already-in-target-state call, or a matrix-invalid repeat, no-ops
-- with { ok:true, changed:false } rather than raising - safe against
-- double-clicks and retries (master prompt §10).
-- ===========================================================================

create function public.transition_bill_document(
  p_id uuid,
  p_to_state text,
  p_reason text default null,
  p_evidence jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws uuid;
  v_from text;
  v_required_capability text;
begin
  select workspace_id, status into v_ws, v_from
  from public.bill_documents where id = p_id for update;
  if v_ws is null then
    raise exception 'not_found' using errcode = 'no_data_found';
  end if;
  if not public.is_workspace_member(v_ws, 'member') then
    raise exception 'not_authorized: not a member of this workspace' using errcode = 'insufficient_privilege';
  end if;

  v_required_capability := case
    when p_to_state in ('approved', 'rejected') then 'bill.approve'
    when p_to_state in ('posting', 'posted', 'matched') then 'bill.post'
    when p_to_state = 'archived' then 'bill.manage'
    else 'bill.review'
  end;
  if not public.has_space_capability(v_ws, v_required_capability) then
    raise exception 'not_authorized: % required', v_required_capability
      using errcode = 'insufficient_privilege';
  end if;

  if v_from = p_to_state then
    return jsonb_build_object('ok', true, 'changed', false, 'status', v_from);
  end if;

  if not public.bill_document_transition_allowed(v_from, p_to_state) then
    return jsonb_build_object(
      'ok', false, 'error', 'invalid_transition',
      'from', v_from, 'to', p_to_state
    );
  end if;

  update public.bill_documents set status = p_to_state where id = p_id;

  perform public.record_bill_event(
    p_id, v_ws, 'user', 'status_changed', v_from, p_to_state, 'ok',
    case when p_reason is null then null else jsonb_build_object('reason', p_reason) end,
    null, null, null, coalesce(p_evidence, '{}'::jsonb)
  );

  -- Approve / reject / archive are material user actions - mirror them
  -- into the Space-wide audit trail too.
  if p_to_state in ('approved', 'rejected', 'archived') then
    perform public.record_space_audit_event(
      v_ws, 'bill.' || p_to_state, 'bill_document', p_id,
      jsonb_build_object('status', v_from),
      jsonb_build_object('status', p_to_state, 'reason', p_reason)
    );
  end if;

  return jsonb_build_object('ok', true, 'changed', true, 'status', p_to_state);
end;
$$;

comment on function public.transition_bill_document is
  'Moves a bill document through its lifecycle. Membership + a target-state-keyed capability (bill.review / bill.approve / bill.post / bill.manage), then bill_document_transition_allowed(). Same-state and matrix-invalid calls no-op instead of raising. Writes a journal entry; approve/reject/archive also write a space audit event.';

revoke all on function public.transition_bill_document(uuid, text, text, jsonb) from public;
grant execute on function public.transition_bill_document(uuid, text, text, jsonb) to authenticated, service_role;

-- ===========================================================================
-- record_bill_original_download - the audit + authorization gate for a
-- signed-URL download of a stored original. Called by
-- app/api/bills/[id]/original BEFORE it issues the URL: it checks
-- membership + bill.download_original (raising insufficient_privilege the
-- route maps to 403), then writes both a processing-journal row and a
-- Space audit event. Returns the storage_key so the route need not
-- re-query it.
-- ===========================================================================

create function public.record_bill_original_download(p_bill_document_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws uuid;
  v_key text;
begin
  select workspace_id, storage_key into v_ws, v_key
  from public.bill_documents where id = p_bill_document_id;
  if v_ws is null then
    raise exception 'not_found' using errcode = 'no_data_found';
  end if;
  if not public.is_workspace_member(v_ws) then
    raise exception 'not_authorized: not a member of this workspace' using errcode = 'insufficient_privilege';
  end if;
  if not public.has_space_capability(v_ws, 'bill.download_original') then
    raise exception 'not_authorized: bill.download_original required' using errcode = 'insufficient_privilege';
  end if;

  perform public.record_bill_event(
    p_bill_document_id, v_ws, 'user', 'original_downloaded', null, null, 'ok', null
  );
  perform public.record_space_audit_event(
    v_ws, 'bill.original_downloaded', 'bill_document', p_bill_document_id, null, null
  );

  return v_key;
end;
$$;

comment on function public.record_bill_original_download is
  'Authorization + audit gate for a stored-original download. Checks membership + bill.download_original, writes a journal row and a Space audit event, returns the storage_key. Raises insufficient_privilege (-> HTTP 403) when the capability is missing.';

revoke all on function public.record_bill_original_download(uuid) from public;
grant execute on function public.record_bill_original_download(uuid) to authenticated, service_role;

-- ===========================================================================
-- get_or_create_bill_processing_policy - lazily materialises the
-- per-workspace policy row with defaults. Member-gated read; the write is
-- the initial insert only (later edits go through a Phase 3 RPC gated on
-- bill.configure).
-- ===========================================================================

create function public.get_or_create_bill_processing_policy(p_workspace_id uuid)
returns public.bill_processing_policies
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.bill_processing_policies;
begin
  if not public.is_workspace_member(p_workspace_id) then
    raise exception 'not_authorized: not a member of this workspace' using errcode = 'insufficient_privilege';
  end if;

  insert into public.bill_processing_policies (workspace_id)
  values (p_workspace_id)
  on conflict (workspace_id) do nothing;

  select * into v_row from public.bill_processing_policies where workspace_id = p_workspace_id;
  return v_row;
end;
$$;

comment on function public.get_or_create_bill_processing_policy is
  'Returns the workspace''s Bills & Expenses policy row, creating it with defaults on first call. Member-gated.';

revoke all on function public.get_or_create_bill_processing_policy(uuid) from public;
grant execute on function public.get_or_create_bill_processing_policy(uuid) to authenticated, service_role;

-- ===========================================================================
-- Row Level Security
-- ===========================================================================

alter table public.bill_documents enable row level security;
alter table public.bill_document_artifacts enable row level security;
alter table public.bill_processing_events enable row level security;
alter table public.bill_processing_policies enable row level security;

-- bill_documents: any active workspace member may read. No authenticated
-- INSERT/UPDATE/DELETE policy at all - every write goes through the
-- SECURITY DEFINER RPCs above or the service role. A member with
-- bill.review may UPDATE the mutable review columns directly in Phase 7;
-- Phase 1 deliberately keeps the surface RPC-only.
create policy bill_documents_select_member on public.bill_documents
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

-- bill_document_artifacts: readable by any workspace member (the file
-- itself is still gated - the bucket is private and only the API routes
-- issue signed URLs). No write policy for authenticated.
create policy bill_document_artifacts_select_member on public.bill_document_artifacts
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

-- bill_processing_events: readable only by members who hold
-- bill.audit.view (master prompt §14: "View audit history" is its own
-- permission).
create policy bill_processing_events_select_auditor on public.bill_processing_events
  for select to authenticated
  using (public.has_space_capability(workspace_id, 'bill.audit.view'));

-- bill_processing_policies: any member may read; only bill.configure may
-- change it (the initial insert is done by the SECURITY DEFINER helper).
create policy bill_processing_policies_select_member on public.bill_processing_policies
  for select to authenticated
  using (public.is_workspace_member(workspace_id));
create policy bill_processing_policies_update_configurer on public.bill_processing_policies
  for update to authenticated
  using (public.has_space_capability(workspace_id, 'bill.configure'))
  with check (public.has_space_capability(workspace_id, 'bill.configure'));

revoke all on public.bill_documents, public.bill_document_artifacts,
  public.bill_processing_events, public.bill_processing_policies from anon;

grant select on public.bill_documents to authenticated;
grant select on public.bill_document_artifacts to authenticated;
grant select on public.bill_processing_events to authenticated;
grant select, update on public.bill_processing_policies to authenticated;

grant select, insert, update, delete on public.bill_documents to service_role;
grant select, insert, update, delete on public.bill_document_artifacts to service_role;
grant select, insert, update, delete on public.bill_processing_events to service_role;
grant select, insert, update, delete on public.bill_processing_policies to service_role;

-- ===========================================================================
-- Spaces capability layer - widen the allowlist for the eight new bill.*
-- capabilities. CREATE OR REPLACE preserves existing grants. Only the
-- capability lists change; every other line is byte-identical to
-- 20260912000000_phase_r_spaces_authz_and_audit.sql.
--
-- Default role mapping:
--   owner  -> all bill.* (owner already returns true for everything)
--   admin  -> all bill.* (admin returns true for everything except
--             space.delete / space.transfer_ownership)
--   member -> bill.upload, bill.review  (added to the member branch below)
--   viewer -> none
-- bill.approve / bill.post / bill.audit.view / bill.configure /
-- bill.manage / bill.download_original stay owner+admin by default; a
-- member can be granted any of them per-workspace via
-- grant_space_capability (now that they are in its allowlist).
-- ===========================================================================

create or replace function public.space_role_has_capability(
  p_kind text,
  p_role text,
  p_capability text
)
returns boolean
language sql
immutable
as $$
  select case
    when p_kind = 'personal' then p_role = 'owner'
    when p_role = 'owner' then true
    when p_role = 'admin'
      then p_capability not in ('space.delete', 'space.transfer_ownership')
    when p_role = 'member'
      then p_capability in (
        'transaction.create', 'transaction.categorize',
        'bill.upload', 'bill.review'
      )
    else false
  end;
$$;

comment on function public.space_role_has_capability is
  'The Spaces capability matrix. Pure/IMMUTABLE. Known capabilities: space.manage_settings, space.delete, space.transfer_ownership, members.manage, budget.manage, goal.manage, rule.manage, report.config, category.manage, transaction.create, transaction.categorize, audit.view, and bill.upload / bill.review / bill.approve / bill.post / bill.manage / bill.download_original / bill.audit.view / bill.configure. Owner: all. Admin: all except space.delete / space.transfer_ownership. Member: transaction.create / transaction.categorize / bill.upload / bill.review. Viewer: none. Per-member exceptions are additive via space_member_capability_grants.';

create or replace function public.grant_space_capability(
  p_workspace_id uuid,
  p_user_id uuid,
  p_capability text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_space_capability(p_workspace_id, 'members.manage') then
    raise exception 'You do not have permission to manage members of this Space.';
  end if;

  if p_capability not in (
    'space.manage_settings', 'space.delete', 'space.transfer_ownership',
    'members.manage', 'budget.manage', 'goal.manage', 'rule.manage',
    'report.config', 'category.manage', 'transaction.create',
    'transaction.categorize', 'audit.view',
    'bill.upload', 'bill.review', 'bill.approve', 'bill.post',
    'bill.manage', 'bill.download_original', 'bill.audit.view',
    'bill.configure'
  ) then
    raise exception 'Unknown capability: %', p_capability;
  end if;

  if not exists (
    select 1 from public.workspace_memberships
    where workspace_id = p_workspace_id
      and user_id = p_user_id
      and status = 'active'
  ) then
    raise exception 'That person is not an active member of this Space.';
  end if;

  insert into public.space_member_capability_grants
    (workspace_id, user_id, capability, granted_by)
  values (p_workspace_id, p_user_id, p_capability, auth.uid())
  on conflict (workspace_id, user_id, capability) do nothing;

  perform public.record_space_audit_event(
    p_workspace_id, 'capability.granted', 'user', p_user_id,
    null, jsonb_build_object('capability', p_capability));
end;
$$;

revoke all on function public.grant_space_capability(uuid, uuid, text) from public;
grant execute on function public.grant_space_capability(uuid, uuid, text) to authenticated;

create or replace function public.revoke_space_capability(
  p_workspace_id uuid,
  p_user_id uuid,
  p_capability text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_space_capability(p_workspace_id, 'members.manage') then
    raise exception 'You do not have permission to manage members of this Space.';
  end if;

  delete from public.space_member_capability_grants
  where workspace_id = p_workspace_id
    and user_id = p_user_id
    and capability = p_capability;

  perform public.record_space_audit_event(
    p_workspace_id, 'capability.revoked', 'user', p_user_id,
    jsonb_build_object('capability', p_capability), null);
end;
$$;

revoke all on function public.revoke_space_capability(uuid, uuid, text) from public;
grant execute on function public.revoke_space_capability(uuid, uuid, text) to authenticated;

-- ===========================================================================
-- Private Storage buckets (master prompt §5/§6/§27). public = false is
-- what denies unauthenticated access; every download goes through a
-- short-lived signed URL issued by app/api/bills/[id]/{original,preview}
-- after that route independently verifies workspace membership (and, for
-- the original, the bill.download_original capability). No
-- storage.objects RLS policies for anon/authenticated - the default
-- (RLS enabled, no matching policy) already denies them; service_role
-- bypasses RLS the same way it does for report-artifacts.
--
--   bill-documents   - immutable originals, written once with upsert:false
--   bill-derivatives - previews / thumbnails / OCR text / extracted JSON
--                      / annotated previews (Phase 2+)
-- ===========================================================================

insert into storage.buckets (id, name, public)
values
  ('bill-documents', 'bill-documents', false),
  ('bill-derivatives', 'bill-derivatives', false)
on conflict (id) do nothing;
