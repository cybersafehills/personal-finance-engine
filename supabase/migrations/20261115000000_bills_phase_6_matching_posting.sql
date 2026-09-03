-- Bills & Expenses - Phase 6: transaction matching & posting.
--
-- Design of record: docs/bills-and-expenses-design.md (Phase 6 row).
-- Master prompt §12 (transaction matching and reconciliation - "a central
-- requirement"), §10 (idempotency).
--
-- The three concepts stay distinct (ADR 0007):
--   * bill_documents  - the evidence + extracted claims (Phases 1-5)
--   * transactions    - real money movement (existing ledger, NEVER written
--                       here - only linked)
--   * bills           - an APPROVED obligation + its accounting treatment
--                       (this phase). Linked to zero or more transactions.
--
-- A document that matches an existing transaction is LINKED, not turned
-- into a second expense. A document with no matching payment posts as an
-- unpaid bill. Posting is idempotent (bills_one_per_document +
-- bills_idempotency_unique + an in-function re-entrancy check).
--
-- Purely additive: three tables, six functions. transactions is only ever
-- read.
--
-- !! PRE-MERGE: run supabase/migrations/tests/run_migration_tests.sh
--    (PostgreSQL 17). The "Bills Phase 6" block covers approve_bill's
--    blocking-finding + unresolved-duplicate + no-self-approval guards,
--    post_bill idempotency (a repeat with the same key is a no-op), the
--    link + "matched" vs "posted" outcomes, service_role-only match
--    generation, and cross-workspace RLS.

-- ===========================================================================
-- bills - an approved obligation. Exactly one per document
-- (bills_one_per_document). Money is integer minor units of `currency`.
-- ===========================================================================

create table public.bills (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  bill_document_id uuid not null references public.bill_documents (id) on delete cascade,
  supplier_id uuid references public.suppliers (id) on delete set null,

  doc_class text,
  currency char(3) not null check (currency = upper(currency)),
  total_minor bigint not null,
  subtotal_minor bigint,
  tax_minor bigint,

  issue_date date,
  due_date date,

  category text,
  budget_id uuid references public.budgets (id) on delete set null,
  notes text,

  paid_state text not null default 'unpaid'
    check (paid_state in ('unpaid', 'partial', 'paid')),
  status text not null default 'open' check (status in ('open', 'void')),

  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz not null default now(),
  posted_by uuid references auth.users (id) on delete set null,
  posted_at timestamptz,
  posted_idempotency_key text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint bills_one_per_document unique (bill_document_id),
  constraint bills_workspace_id_id_unique unique (workspace_id, id)
);

comment on table public.bills is
  'An approved obligation + its accounting treatment (master prompt §12, ADR 0007). One per bill_document. Distinct from transactions (real money movement, only linked here, never written). paid_state is derived at posting from whether transactions were linked.';

create trigger set_bills_updated_at
  before update on public.bills
  for each row execute function public.set_updated_at();

-- Idempotency: one successful post per (workspace, key).
create unique index bills_idempotency_unique
  on public.bills (workspace_id, posted_idempotency_key)
  where posted_idempotency_key is not null;
create index idx_bills_workspace_status
  on public.bills (workspace_id, status, paid_state);
create index idx_bills_supplier on public.bills (supplier_id);

-- ===========================================================================
-- bill_transaction_links - many-to-many bill <-> transactions. A NULL
-- allocation_minor means the whole transaction supports this bill.
-- ===========================================================================

create table public.bill_transaction_links (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.bills (id) on delete cascade,
  workspace_id uuid not null,
  transaction_id uuid not null references public.transactions (id) on delete cascade,
  allocation_minor bigint check (allocation_minor is null or allocation_minor > 0),
  confirmed_by uuid references auth.users (id) on delete set null,
  confirmed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),

  constraint bill_transaction_links_unique unique (bill_id, transaction_id),
  constraint bill_transaction_links_bill_same_workspace
    foreign key (workspace_id, bill_id)
    references public.bills (workspace_id, id),
  constraint bill_transaction_links_txn_same_workspace
    foreign key (workspace_id, transaction_id)
    references public.transactions (workspace_id, id)
);

comment on table public.bill_transaction_links is
  'Links an approved bill to the transaction(s) that pay it. Supports 1:1, one invoice paid by several transactions, and one transaction covering several bills. transactions is never modified.';

create index idx_bill_transaction_links_bill on public.bill_transaction_links (bill_id);
create index idx_bill_transaction_links_txn on public.bill_transaction_links (transaction_id);

-- ===========================================================================
-- bill_transaction_match_candidates - ranked transaction matches the
-- worker generated for a document, with reasons for and against.
-- ===========================================================================

create table public.bill_transaction_match_candidates (
  id uuid primary key default gen_random_uuid(),
  bill_document_id uuid not null references public.bill_documents (id) on delete cascade,
  workspace_id uuid not null,
  transaction_id uuid not null references public.transactions (id) on delete cascade,
  is_current boolean not null default true,
  score numeric(5, 4) not null check (score >= 0 and score <= 1),
  reasons_for text[] not null default array[]::text[],
  reasons_against text[] not null default array[]::text[],
  created_at timestamptz not null default now(),

  constraint bill_tmc_doc_same_workspace
    foreign key (workspace_id, bill_document_id)
    references public.bill_documents (workspace_id, id),
  constraint bill_tmc_txn_same_workspace
    foreign key (workspace_id, transaction_id)
    references public.transactions (workspace_id, id)
);

create unique index bill_tmc_unique_current
  on public.bill_transaction_match_candidates (bill_document_id, transaction_id)
  where is_current;
create index idx_bill_tmc_doc
  on public.bill_transaction_match_candidates (bill_document_id) where is_current;

-- ===========================================================================
-- get_bill_transaction_search_set - candidate transactions for a
-- document's matching. SERVICE_ROLE ONLY. Outgoing, successful workspace
-- transactions near the issue date (or the last 90 days if none), not
-- already linked to a bill.
-- ===========================================================================

create function public.get_bill_transaction_search_set(p_bill_document_id uuid)
returns table (
  transaction_id uuid,
  occurred_at timestamptz,
  amount_minor bigint,
  currency text,
  counterparty_name text,
  counterparty_reference text
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_ws uuid;
  v_ext uuid;
  v_issue date;
begin
  select workspace_id into v_ws from public.bill_documents where id = p_bill_document_id;
  if v_ws is null then
    return;
  end if;

  select e.id into v_ext from public.bill_extractions e
  where e.bill_document_id = p_bill_document_id and e.is_current;

  select f.normalized_value::date into v_issue
  from public.bill_extracted_fields f
  where f.extraction_id = v_ext and f.field_key = 'issue_date'
    and f.normalized_value ~ '^\d{4}-\d{2}-\d{2}$';

  return query
  select
    t.id, t.occurred_at, t.amount_rwf, t.currency::text,
    t.counterparty_name, t.counterparty_reference
  from public.transactions t
  where t.workspace_id = v_ws
    and t.direction = 'out'
    and t.status = 'success'
    and not exists (select 1 from public.bill_transaction_links l where l.transaction_id = t.id)
    and (
      v_issue is null
      or t.occurred_at between (v_issue - interval '30 days') and (v_issue + interval '30 days')
    )
    and (v_issue is not null or t.occurred_at >= now() - interval '90 days')
  order by t.occurred_at desc
  limit 200;
end;
$$;

comment on function public.get_bill_transaction_search_set is
  'Worker-only (service_role). Outgoing successful workspace transactions near the document''s issue date (last 90 days if none), excluding any already linked to a bill. transactions.amount_rwf is minor units of the row''s own currency.';

revoke all on function public.get_bill_transaction_search_set(uuid) from public;
grant execute on function public.get_bill_transaction_search_set(uuid) to service_role;

-- ===========================================================================
-- record_bill_transaction_match_candidates - the worker's write point.
-- SERVICE ROLE ONLY.
-- ===========================================================================

create function public.record_bill_transaction_match_candidates(payload jsonb)
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

  update public.bill_transaction_match_candidates set is_current = false
  where bill_document_id = v_doc and is_current;

  for v_cand in select * from jsonb_array_elements(coalesce(payload->'candidates', '[]'::jsonb)) loop
    insert into public.bill_transaction_match_candidates (
      bill_document_id, workspace_id, transaction_id, is_current, score,
      reasons_for, reasons_against
    ) values (
      v_doc, v_ws, (v_cand->>'transaction_id')::uuid, true,
      coalesce(nullif(v_cand->>'score', '')::numeric, 0),
      coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(v_cand->'reasons_for', '[]'::jsonb)) as a(x)), array[]::text[]),
      coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(v_cand->'reasons_against', '[]'::jsonb)) as a(x)), array[]::text[])
    )
    on conflict (bill_document_id, transaction_id) where is_current do nothing;
    v_count := v_count + 1;
  end loop;

  if v_count > 0 then
    perform public.record_bill_event(
      v_doc, v_ws, 'system', 'transaction_match_candidate_generated', null, null, 'ok',
      jsonb_build_object('candidates', v_count)
    );
  end if;

  return jsonb_build_object('ok', true, 'candidates', v_count);
end;
$$;

revoke all on function public.record_bill_transaction_match_candidates(jsonb) from public;
grant execute on function public.record_bill_transaction_match_candidates(jsonb) to service_role;

-- ===========================================================================
-- approve_bill - a bill.approve holder approves a reviewed document and
-- the bills obligation row is created. Guards (master prompt §12/§14):
--   * document is in needs_review / under_review
--   * no current validation finding with blocks_approval = true
--   * no unresolved exact/probable duplicate candidate
--   * no self-approval when the workspace has more than one active member
--   * currency + total must be present
-- Idempotent: a second call returns the existing bill.
--
-- payload: { bill_document_id, category, budget_id, notes }
-- ===========================================================================

create function public.approve_bill(payload jsonb)
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
begin
  select workspace_id, status, created_by, supplier_id
    into v_ws, v_status, v_created_by, v_supplier
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

  -- No unresolved likely-duplicate.
  if exists (
    select 1 from public.bill_duplicate_candidates d
    where d.bill_document_id = v_doc and d.is_current
      and d.resolution = 'unresolved' and d.relation in ('exact', 'probable')
  ) then
    return jsonb_build_object('ok', false, 'error', 'unresolved_duplicate');
  end if;

  -- Separation of duties: no self-approval in a multi-member workspace.
  select count(*) into v_members from public.workspace_memberships
  where workspace_id = v_ws and status = 'active';
  if v_created_by = auth.uid() and v_members > 1 then
    return jsonb_build_object('ok', false, 'error', 'self_approval_forbidden');
  end if;

  select id into v_ext from public.bill_extractions
  where bill_document_id = v_doc and is_current;

  select
    (max(coalesce(normalized_value, raw_value)) filter (where field_key = 'currency')),
    (max(normalized_value) filter (where field_key = 'total'))::bigint,
    (max(normalized_value) filter (where field_key = 'subtotal'))::bigint,
    (max(normalized_value) filter (where field_key = 'tax_amount'))::bigint,
    (max(normalized_value) filter (where field_key = 'issue_date' and normalized_value ~ '^\d{4}-\d{2}-\d{2}$'))::date,
    (max(normalized_value) filter (where field_key = 'due_date' and normalized_value ~ '^\d{4}-\d{2}-\d{2}$'))::date
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

comment on function public.approve_bill is
  'bill.approve-gated. Guards: reviewable status, no blocking validation finding, no unresolved exact/probable duplicate, no self-approval in a multi-member workspace, currency + total present. Creates the bills obligation row and moves the document to approved. Idempotent.';

revoke all on function public.approve_bill(jsonb) from public;
grant execute on function public.approve_bill(jsonb) to authenticated;

-- ===========================================================================
-- post_bill - a bill.post holder posts an approved bill, optionally
-- linking it to the transaction(s) that pay it. Idempotent on
-- idempotency_key. Never writes transactions.
--
-- payload: { bill_document_id, idempotency_key, transaction_ids:[uuid], paid_state }
--   * transaction_ids present  -> links + document -> 'matched'
--   * transaction_ids empty    -> unpaid obligation + document -> 'posted'
-- ===========================================================================

create function public.post_bill(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc uuid := (payload->>'bill_document_id')::uuid;
  v_key text := nullif(payload->>'idempotency_key', '');
  v_ws uuid;
  v_bill public.bills%rowtype;
  v_txn uuid;
  v_txn_ok boolean;
  v_links int := 0;
  v_final text;
  v_paid text;
begin
  if v_key is null then
    raise exception 'idempotency_key required' using errcode = 'check_violation';
  end if;

  select workspace_id into v_ws from public.bill_documents where id = v_doc for update;
  if v_ws is null then
    raise exception 'not_found' using errcode = 'no_data_found';
  end if;
  if not public.is_workspace_member(v_ws, 'member') then
    raise exception 'not_authorized' using errcode = 'insufficient_privilege';
  end if;
  if not public.has_space_capability(v_ws, 'bill.post') then
    raise exception 'not_authorized: bill.post required' using errcode = 'insufficient_privilege';
  end if;

  select * into v_bill from public.bills where bill_document_id = v_doc for update;
  if v_bill.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_approved');
  end if;

  -- Idempotent replay.
  if v_bill.posted_at is not null then
    if v_bill.posted_idempotency_key is not distinct from v_key then
      return jsonb_build_object(
        'ok', true, 'bill_id', v_bill.id, 'already', true,
        'status', (select status from public.bill_documents where id = v_doc)
      );
    end if;
    return jsonb_build_object('ok', false, 'error', 'already_posted');
  end if;

  update public.bill_documents set status = 'posting' where id = v_doc;
  perform public.record_bill_event(v_doc, v_ws, 'user', 'posting_started', 'approved', 'posting', 'ok');

  for v_txn in
    select (value)::uuid from jsonb_array_elements_text(coalesce(payload->'transaction_ids', '[]'::jsonb))
  loop
    select exists (
      select 1 from public.transactions t where t.id = v_txn and t.workspace_id = v_ws
    ) into v_txn_ok;
    if not v_txn_ok then
      raise exception 'invalid_transaction: %', v_txn using errcode = 'foreign_key_violation';
    end if;
    if exists (
      select 1 from public.bill_transaction_links l
      where l.transaction_id = v_txn and l.bill_id <> v_bill.id
    ) then
      raise exception 'transaction_already_linked: %', v_txn using errcode = 'unique_violation';
    end if;

    insert into public.bill_transaction_links (bill_id, workspace_id, transaction_id, confirmed_by)
    values (v_bill.id, v_ws, v_txn, auth.uid())
    on conflict (bill_id, transaction_id) do nothing;
    v_links := v_links + 1;

    perform public.record_bill_event(
      v_doc, v_ws, 'user', 'transaction_linked', null, null, 'ok',
      jsonb_build_object('transaction_id', v_txn)
    );
  end loop;

  v_paid := coalesce(
    nullif(payload->>'paid_state', ''),
    case when v_links > 0 then 'paid' else 'unpaid' end
  );
  v_final := case when v_links > 0 then 'matched' else 'posted' end;

  update public.bills set
    posted_by = auth.uid(), posted_at = now(),
    posted_idempotency_key = v_key, paid_state = v_paid
  where id = v_bill.id;

  update public.bill_documents set status = v_final where id = v_doc;
  perform public.record_bill_event(v_doc, v_ws, 'user', 'ledger_record_created', 'posting', v_final, 'ok',
    jsonb_build_object('bill_id', v_bill.id, 'links', v_links));
  perform public.record_space_audit_event(
    v_ws, 'bill.posted', 'bill_document', v_doc,
    jsonb_build_object('status', 'approved'),
    jsonb_build_object('bill_id', v_bill.id, 'links', v_links, 'paid_state', v_paid, 'final', v_final)
  );

  return jsonb_build_object('ok', true, 'bill_id', v_bill.id, 'links', v_links, 'status', v_final);
end;
$$;

comment on function public.post_bill is
  'bill.post-gated. Idempotent on idempotency_key. Links the approved bill to the paying transaction(s) (document -> matched) or posts it as an unpaid obligation (document -> posted). Never writes the transactions ledger. A retry with the same key is a no-op returning the existing result.';

revoke all on function public.post_bill(jsonb) from public;
grant execute on function public.post_bill(jsonb) to authenticated;

-- ===========================================================================
-- confirm_bill_transaction_match / unlink_bill_transaction - post-hoc
-- link adjustments by a bill.review holder.
-- ===========================================================================

create function public.confirm_bill_transaction_match(
  p_bill_document_id uuid,
  p_transaction_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws uuid;
  v_bill uuid;
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

  select id into v_bill from public.bills where bill_document_id = p_bill_document_id;
  if v_bill is null then
    return jsonb_build_object('ok', false, 'error', 'not_approved');
  end if;
  if not exists (select 1 from public.transactions where id = p_transaction_id and workspace_id = v_ws) then
    raise exception 'invalid_transaction' using errcode = 'foreign_key_violation';
  end if;
  if exists (
    select 1 from public.bill_transaction_links
    where transaction_id = p_transaction_id and bill_id <> v_bill
  ) then
    return jsonb_build_object('ok', false, 'error', 'transaction_already_linked');
  end if;

  insert into public.bill_transaction_links (bill_id, workspace_id, transaction_id, confirmed_by)
  values (v_bill, v_ws, p_transaction_id, auth.uid())
  on conflict (bill_id, transaction_id) do nothing;

  perform public.record_bill_event(
    p_bill_document_id, v_ws, 'user', 'transaction_linked', null, null, 'ok',
    jsonb_build_object('transaction_id', p_transaction_id)
  );
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.confirm_bill_transaction_match(uuid, uuid) from public;
grant execute on function public.confirm_bill_transaction_match(uuid, uuid) to authenticated;

create function public.unlink_bill_transaction(p_link_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws uuid;
  v_doc uuid;
  v_txn uuid;
begin
  select l.workspace_id, b.bill_document_id, l.transaction_id
    into v_ws, v_doc, v_txn
  from public.bill_transaction_links l
  join public.bills b on b.id = l.bill_id
  where l.id = p_link_id;
  if v_ws is null then
    raise exception 'not_found' using errcode = 'no_data_found';
  end if;
  if not public.is_workspace_member(v_ws, 'member') then
    raise exception 'not_authorized' using errcode = 'insufficient_privilege';
  end if;
  if not public.has_space_capability(v_ws, 'bill.review') then
    raise exception 'not_authorized: bill.review required' using errcode = 'insufficient_privilege';
  end if;

  delete from public.bill_transaction_links where id = p_link_id;
  perform public.record_bill_event(
    v_doc, v_ws, 'user', 'transaction_linked', null, null, 'ok',
    jsonb_build_object('unlinked_transaction_id', v_txn)
  );
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.unlink_bill_transaction(uuid) from public;
grant execute on function public.unlink_bill_transaction(uuid) to authenticated;

-- ===========================================================================
-- RLS
-- ===========================================================================

alter table public.bills enable row level security;
alter table public.bill_transaction_links enable row level security;
alter table public.bill_transaction_match_candidates enable row level security;

create policy bills_select_member on public.bills
  for select to authenticated using (public.is_workspace_member(workspace_id));
create policy bill_transaction_links_select_member on public.bill_transaction_links
  for select to authenticated using (public.is_workspace_member(workspace_id));
create policy bill_tmc_select_member on public.bill_transaction_match_candidates
  for select to authenticated using (public.is_workspace_member(workspace_id));

revoke all on public.bills, public.bill_transaction_links,
  public.bill_transaction_match_candidates from anon;

grant select on public.bills to authenticated;
grant select on public.bill_transaction_links to authenticated;
grant select on public.bill_transaction_match_candidates to authenticated;

grant select, insert, update, delete on public.bills to service_role;
grant select, insert, update, delete on public.bill_transaction_links to service_role;
grant select, insert, update, delete on public.bill_transaction_match_candidates to service_role;
