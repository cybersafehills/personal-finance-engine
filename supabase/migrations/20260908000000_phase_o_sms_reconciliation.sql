-- Phase O: OneLedger Pay & Services - Phase 2b (SMS-to-intent
-- reconciliation & ledger linking).
--
-- When the Mobile Money SMS for a handed-off Assisted Quick Pay
-- (Phase 2a) payment is ingested by supabase/functions/ingest-momo and
-- turned into a `transactions` row, deterministically LINK that row to
-- its `payment_intent`, advance the intent to `verified`, and surface
-- the evidence. Non-custodial: this NEVER creates a second ledger
-- transaction - it only links the one ingestion already made.
-- Conflicting evidence -> `requires_reconciliation`, never a guess.
--
-- Ships observe-only: the callers pass p_mode = 'observe' (default) or
-- 'apply'. In 'observe' a candidate `payment_reconciliations` row is
-- written for accuracy review but the intent / transaction are not
-- mutated. See docs/pay-and-services.md and
-- docs/adr/0003-sms-reconciliation-and-ledger-integrity.md.
--
-- The `payment_reconciliations` table, its partial-unique indexes, and
-- its RLS select policy already exist from Phase N (20260907000000).

-- ===========================================================================
-- payment_reconciliations: resolution columns.
-- ===========================================================================
alter table public.payment_reconciliations
  add column if not exists applied_at timestamptz,
  add column if not exists rejected_reason text,
  add column if not exists resolved_by uuid references auth.users (id) on delete set null;

comment on column public.payment_reconciliations.applied_at is
  'When this link was actually applied to the intent + ledger. NULL = recorded in observe mode for accuracy review, not yet applied.';

create index if not exists idx_payment_reconciliations_queue
  on public.payment_reconciliations (workspace_id, status, applied_at);

-- ===========================================================================
-- normalize_rw_msisdn: SQL mirror of
-- web/lib/pay/phone.ts#normalizeRwandaMsisdn. Canonical form
-- 2507XXXXXXXX (12 digits, no +). Kept in sync BY HAND - if you change
-- the rule in one place, change it in the other (same discipline as
-- policy-engine.ts <-> policy_matches_transaction(), see
-- docs/categorization-engine.md).
-- ===========================================================================
create function public.normalize_rw_msisdn(raw text)
returns text
language plpgsql
immutable
as $$
declare
  digits text;
  candidate text;
begin
  if raw is null then
    return null;
  end if;
  digits := regexp_replace(raw, '[^0-9]', '', 'g');
  if digits ~ '^250[0-9]{9}$' then
    candidate := digits;
  elsif digits ~ '^0[0-9]{9}$' then
    candidate := '250' || substr(digits, 2);
  elsif digits ~ '^7[0-9]{8}$' then
    candidate := '250' || digits;
  else
    return null;
  end if;
  if candidate ~ '^2507[2389][0-9]{7}$' then
    return candidate;
  end if;
  return null;
end;
$$;

comment on function public.normalize_rw_msisdn(text) is
  'Rwandan MSISDN -> canonical 2507XXXXXXXX, or NULL. SQL mirror of web/lib/pay/phone.ts#normalizeRwandaMsisdn - keep in sync by hand.';

revoke all on function public.normalize_rw_msisdn(text) from public;
grant execute on function public.normalize_rw_msisdn(text) to authenticated;
grant execute on function public.normalize_rw_msisdn(text) to service_role;

-- ===========================================================================
-- system_transition_payment_intent: the system-actor twin of Phase N's
-- transition_payment_intent. service_role ONLY - the only path to
-- successful / requires_reconciliation / reversed. Uses the same
-- payment_intent_transition_allowed() gate (Phase N), with the actor
-- from p_evidence->>'actor' (default 'system').
-- ===========================================================================
create function public.system_transition_payment_intent(
  p_id uuid, p_to_state text, p_reason text default null, p_evidence jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws uuid;
  v_from text;
  v_actor text := coalesce(nullif(p_evidence->>'actor', ''), 'system');
begin
  if v_actor not in ('system', 'ingestion') then
    v_actor := 'system';
  end if;

  select workspace_id, state into v_ws, v_from
  from public.payment_intents where id = p_id for update;
  if v_ws is null then
    raise exception 'not_found' using errcode = 'no_data_found';
  end if;

  if not public.payment_intent_transition_allowed(v_from, p_to_state, v_actor) then
    raise exception 'invalid_transition: % -> % (actor %)', v_from, p_to_state, v_actor
      using errcode = 'check_violation';
  end if;

  update public.payment_intents set state = p_to_state where id = p_id;

  insert into public.payment_events (payment_intent_id, workspace_id, event_type, from_state, to_state, actor_type, reason, evidence)
  values (
    p_id, v_ws,
    case p_to_state
      when 'successful' then 'state_change'
      when 'requires_reconciliation' then 'reconciliation_conflict'
      when 'reversed' then 'state_change'
      else 'state_change'
    end,
    v_from, p_to_state, v_actor, p_reason, coalesce(p_evidence, '{}'::jsonb)
  );
end;
$$;

revoke all on function public.system_transition_payment_intent(uuid, text, text, jsonb) from public;
revoke all on function public.system_transition_payment_intent(uuid, text, text, jsonb) from authenticated;
grant execute on function public.system_transition_payment_intent(uuid, text, text, jsonb) to service_role;

-- ===========================================================================
-- Internal helper: apply a linked reconciliation's effects to the intent
-- and (as a review-queue SUGGESTION only) the transaction's category.
-- Assumes the payment_reconciliations row `p_recon_id` exists and is
-- status='linked'. Idempotent-ish: re-running is harmless.
-- ===========================================================================
create function public.apply_reconciliation_effects(p_recon_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recon record;
  v_intent record;
  v_txn record;
begin
  select * into v_recon from public.payment_reconciliations where id = p_recon_id;
  if v_recon is null or v_recon.status <> 'linked' then
    return;
  end if;

  select * into v_intent from public.payment_intents where id = v_recon.payment_intent_id for update;
  select * into v_txn from public.transactions where id = v_recon.transaction_id;

  -- Intent: link + verify + succeed (via the state machine).
  update public.payment_intents
  set linked_transaction_id = v_recon.transaction_id,
      verified_at = coalesce(verified_at, now())
  where id = v_intent.id;

  if v_intent.state in ('initiated', 'awaiting_verification', 'processing') then
    perform public.system_transition_payment_intent(
      v_intent.id, 'successful',
      'Deterministic SMS reconciliation',
      jsonb_build_object('actor', 'ingestion', 'reconciliation_id', p_recon_id)
    );
  end if;

  update public.payment_reconciliations set applied_at = coalesce(applied_at, now()) where id = p_recon_id;

  -- Transaction category: SUGGESTION only, and never over a stronger
  -- decision. Direct evidence outranks user policies (decision
  -- hierarchy) - so we only fill an uncategorized/suggested row, never
  -- an auto/provisional/confirmed/manual one.
  if v_intent.category is not null
     and v_txn.category_decision_status in ('uncategorized', 'suggested')
     and v_txn.category_source is distinct from 'manual' then
    update public.transactions
    set suggested_category = v_intent.category,
        suggested_subcategory = null,
        category_decision_status = 'suggested'
    where id = v_txn.id;

    insert into public.transaction_category_history (
      transaction_id, workspace_id,
      previous_category, previous_subcategory, previous_category_source, previous_category_confidence,
      new_category, new_subcategory, new_category_source, new_category_confidence,
      new_decision_status, decision_reason, actor_type, engine_version
    ) values (
      v_txn.id, v_txn.workspace_id,
      v_txn.category, v_txn.subcategory, v_txn.category_source, v_txn.category_confidence,
      v_intent.category, null, 'system', null,
      'suggested',
      format('Linked to a OneLedger Pay payment intent (%s)', v_intent.id),
      'system', 'payment-reconciliation@1'
    );
  end if;
end;
$$;

revoke all on function public.apply_reconciliation_effects(uuid) from public;
revoke all on function public.apply_reconciliation_effects(uuid) from authenticated;
grant execute on function public.apply_reconciliation_effects(uuid) to service_role;

-- ===========================================================================
-- Internal helper: the deterministic candidate-intent predicate for a
-- given transaction. Returns matching intent ids. SQL mirror of
-- supabase/functions/_shared/payment-reconciliation.ts#matchTransactionToIntents
-- (rules list) - keep in sync by hand.
-- ===========================================================================
create function public.reconciliation_candidate_intents(p_transaction_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select i.id
  from public.transactions t
  join public.payment_intents i
    on i.workspace_id = t.workspace_id
   and i.state in ('initiated', 'awaiting_verification')
   and i.linked_transaction_id is null
   and i.amount_minor = t.amount_rwf
   and i.recipient_msisdn_normalized is not null
   and i.recipient_msisdn_normalized = public.normalize_rw_msisdn(t.counterparty_reference)
   and t.occurred_at >= i.created_at - interval '10 minutes'
   and t.occurred_at <= coalesce(i.expires_at, i.created_at + interval '24 hours')
   and (
     i.provider is null
     or (i.provider = 'mtn' and t.source = 'mtn_momo')
     or (i.provider = 'airtel' and t.source = 'mtn_momo')  -- Airtel SMS also ingests as mtn_momo-shaped today; tighten when a dedicated source exists
     or (i.provider not in ('mtn', 'airtel'))
   )
  where t.id = p_transaction_id
    and t.direction = 'out'
    and t.status = 'success'
    and t.currency = 'RWF'
    and not exists (
      select 1 from public.payment_reconciliations r
      where r.transaction_id = t.id and r.status = 'linked'
    );
$$;

revoke all on function public.reconciliation_candidate_intents(uuid) from public;
revoke all on function public.reconciliation_candidate_intents(uuid) from authenticated;
grant execute on function public.reconciliation_candidate_intents(uuid) to service_role;

-- ===========================================================================
-- reconcile_transaction_with_payment_intents: the authoritative matcher.
-- service_role ONLY. Called best-effort from ingest-momo and the retry
-- cron. Atomic. Idempotent (partial-unique indexes on
-- payment_reconciliations + the not-exists guard above).
-- ===========================================================================
create function public.reconcile_transaction_with_payment_intents(
  p_transaction_id uuid, p_mode text default 'observe'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mode text := case when p_mode = 'apply' then 'apply' else 'observe' end;
  v_txn record;
  v_ids uuid[];
  v_id uuid;
  v_recon_id uuid;
  v_count int;
begin
  select * into v_txn from public.transactions where id = p_transaction_id;
  if v_txn is null then
    return jsonb_build_object('status', 'skipped', 'reason', 'transaction_not_found');
  end if;
  if v_txn.direction <> 'out' or v_txn.status <> 'success' or v_txn.currency <> 'RWF' then
    return jsonb_build_object('status', 'skipped', 'reason', 'not_an_outgoing_rwf_success');
  end if;
  if exists (select 1 from public.payment_reconciliations r where r.transaction_id = p_transaction_id and r.status = 'linked') then
    return jsonb_build_object('status', 'skipped', 'reason', 'already_linked');
  end if;

  v_ids := array(select public.reconciliation_candidate_intents(p_transaction_id));
  v_count := coalesce(array_length(v_ids, 1), 0);

  if v_count = 0 then
    return jsonb_build_object('status', 'no_match');
  end if;

  if v_count = 1 then
    v_id := v_ids[1];
    insert into public.payment_reconciliations (
      payment_intent_id, workspace_id, transaction_id, match_method, match_score, matched_on, status,
      applied_at
    ) values (
      v_id, v_txn.workspace_id, p_transaction_id, 'deterministic', 1.0,
      jsonb_build_object('amount', true, 'msisdn', true, 'time_window', true, 'mode', v_mode),
      'linked',
      case when v_mode = 'apply' then now() else null end
    )
    returning id into v_recon_id;

    insert into public.payment_events (payment_intent_id, workspace_id, event_type, actor_type, reason, evidence)
    values (v_id, v_txn.workspace_id, 'reconciliation_linked', 'ingestion',
            'Deterministic SMS match',
            jsonb_build_object('transaction_id', p_transaction_id, 'mode', v_mode, 'reconciliation_id', v_recon_id));

    if v_mode = 'apply' then
      perform public.apply_reconciliation_effects(v_recon_id);
    end if;

    return jsonb_build_object('status', 'linked', 'intent_id', v_id, 'reconciliation_id', v_recon_id, 'mode', v_mode);
  end if;

  -- Ambiguous: one conflict row per candidate, never a guess.
  foreach v_id in array v_ids loop
    insert into public.payment_reconciliations (
      payment_intent_id, workspace_id, transaction_id, match_method, matched_on, status
    ) values (
      v_id, v_txn.workspace_id, p_transaction_id, 'deterministic',
      jsonb_build_object('amount', true, 'msisdn', true, 'time_window', true, 'ambiguous', true, 'mode', v_mode),
      'conflict'
    );
    insert into public.payment_events (payment_intent_id, workspace_id, event_type, actor_type, reason, evidence)
    values (v_id, v_txn.workspace_id, 'reconciliation_conflict', 'ingestion',
            'Multiple intents match one transaction',
            jsonb_build_object('transaction_id', p_transaction_id, 'candidate_count', v_count, 'mode', v_mode));
    if v_mode = 'apply' then
      begin
        perform public.system_transition_payment_intent(
          v_id, 'requires_reconciliation', 'Ambiguous SMS match',
          jsonb_build_object('actor', 'ingestion', 'transaction_id', p_transaction_id)
        );
      exception when others then
        -- already terminal / not transitionable: leave it, the conflict row is enough.
        null;
      end;
    end if;
  end loop;

  return jsonb_build_object('status', 'conflict', 'candidate_count', v_count, 'mode', v_mode);
end;
$$;

revoke all on function public.reconcile_transaction_with_payment_intents(uuid, text) from public;
revoke all on function public.reconcile_transaction_with_payment_intents(uuid, text) from authenticated;
grant execute on function public.reconcile_transaction_with_payment_intents(uuid, text) to service_role;

-- ===========================================================================
-- reconcile_payment_intent: symmetric entry point (given an intent, find
-- a matching recent unlinked transaction). Called from recordHandoff and
-- the retry cron. service_role ONLY.
-- ===========================================================================
create function public.reconcile_payment_intent(p_intent_id uuid, p_mode text default 'observe')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_intent record;
  v_txn_id uuid;
begin
  select * into v_intent from public.payment_intents where id = p_intent_id;
  if v_intent is null then
    return jsonb_build_object('status', 'skipped', 'reason', 'intent_not_found');
  end if;
  if v_intent.state not in ('initiated', 'awaiting_verification') or v_intent.linked_transaction_id is not null then
    return jsonb_build_object('status', 'skipped', 'reason', 'intent_not_open');
  end if;
  if v_intent.recipient_msisdn_normalized is null then
    return jsonb_build_object('status', 'skipped', 'reason', 'no_recipient_msisdn');
  end if;

  select t.id into v_txn_id
  from public.transactions t
  where t.workspace_id = v_intent.workspace_id
    and t.direction = 'out'
    and t.status = 'success'
    and t.currency = 'RWF'
    and t.amount_rwf = v_intent.amount_minor
    and public.normalize_rw_msisdn(t.counterparty_reference) = v_intent.recipient_msisdn_normalized
    and t.occurred_at >= v_intent.created_at - interval '10 minutes'
    and t.occurred_at <= coalesce(v_intent.expires_at, v_intent.created_at + interval '24 hours')
    and not exists (
      select 1 from public.payment_reconciliations r
      where r.transaction_id = t.id and r.status = 'linked'
    )
  order by t.occurred_at desc
  limit 1;

  if v_txn_id is null then
    return jsonb_build_object('status', 'no_match');
  end if;

  return public.reconcile_transaction_with_payment_intents(v_txn_id, p_mode);
end;
$$;

revoke all on function public.reconcile_payment_intent(uuid, text) from public;
revoke all on function public.reconcile_payment_intent(uuid, text) from authenticated;
grant execute on function public.reconcile_payment_intent(uuid, text) to service_role;

-- ===========================================================================
-- User-facing resolution RPCs (workspace-member gated).
-- ===========================================================================

-- Promote an observe-mode linked row (applied_at null) to applied.
create function public.apply_payment_reconciliation(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws uuid;
  v_status text;
begin
  select workspace_id, status into v_ws, v_status
  from public.payment_reconciliations where id = p_id for update;
  if v_ws is null then
    raise exception 'not_found' using errcode = 'no_data_found';
  end if;
  if not public.is_workspace_member(v_ws, 'member') then
    raise exception 'not_authorized' using errcode = 'insufficient_privilege';
  end if;
  if v_status <> 'linked' then
    raise exception 'not_linkable: reconciliation is %', v_status using errcode = 'check_violation';
  end if;
  perform public.apply_reconciliation_effects(p_id);
end;
$$;

revoke all on function public.apply_payment_reconciliation(uuid) from public;
grant execute on function public.apply_payment_reconciliation(uuid) to authenticated;

-- Reject a candidate (observed or conflict) reconciliation row.
create function public.reject_payment_reconciliation(p_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws uuid;
  v_intent uuid;
begin
  select workspace_id, payment_intent_id into v_ws, v_intent
  from public.payment_reconciliations where id = p_id for update;
  if v_ws is null then
    raise exception 'not_found' using errcode = 'no_data_found';
  end if;
  if not public.is_workspace_member(v_ws, 'member') then
    raise exception 'not_authorized' using errcode = 'insufficient_privilege';
  end if;

  update public.payment_reconciliations
  set status = 'rejected', rejected_reason = p_reason, resolved_by = auth.uid()
  where id = p_id and status <> 'linked';
  -- (a status='linked', already-applied row is not rejectable here - unlink is a separate concern.)

  update public.payment_reconciliations
  set status = 'rejected', rejected_reason = p_reason, resolved_by = auth.uid()
  where id = p_id and status = 'linked' and applied_at is null;

  insert into public.payment_events (payment_intent_id, workspace_id, event_type, actor_type, actor_user_id, reason)
  values (v_intent, v_ws, 'state_change', 'user', auth.uid(), coalesce(p_reason, 'reconciliation rejected'));
end;
$$;

revoke all on function public.reject_payment_reconciliation(uuid, text) from public;
grant execute on function public.reject_payment_reconciliation(uuid, text) to authenticated;

-- Manually link an intent to a transaction the user picked.
create function public.link_payment_manually(p_intent_id uuid, p_transaction_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_iws uuid;
  v_istate text;
  v_tws uuid;
  v_recon_id uuid;
begin
  select workspace_id, state into v_iws, v_istate from public.payment_intents where id = p_intent_id for update;
  select workspace_id into v_tws from public.transactions where id = p_transaction_id;
  if v_iws is null or v_tws is null then
    raise exception 'not_found' using errcode = 'no_data_found';
  end if;
  if v_iws <> v_tws then
    raise exception 'cross_workspace' using errcode = 'check_violation';
  end if;
  if not public.is_workspace_member(v_iws, 'member') then
    raise exception 'not_authorized' using errcode = 'insufficient_privilege';
  end if;
  if v_istate not in ('initiated', 'awaiting_verification', 'requires_reconciliation') then
    raise exception 'not_linkable: intent is %', v_istate using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.payment_reconciliations r where r.transaction_id = p_transaction_id and r.status = 'linked') then
    raise exception 'transaction_already_linked' using errcode = 'unique_violation';
  end if;

  -- If the intent is requires_reconciliation, first move it back to a
  -- transitionable open state so apply_reconciliation_effects can
  -- succeed cleanly.
  if v_istate = 'requires_reconciliation' then
    update public.payment_intents set state = 'awaiting_verification' where id = p_intent_id;
    -- drop any stale conflict rows for this intent
    update public.payment_reconciliations set status = 'rejected', rejected_reason = 'superseded by manual link', resolved_by = auth.uid()
    where payment_intent_id = p_intent_id and status = 'conflict';
  end if;

  insert into public.payment_reconciliations (
    payment_intent_id, workspace_id, transaction_id, match_method, matched_on, status, applied_at, resolved_by
  ) values (
    p_intent_id, v_iws, p_transaction_id, 'manual',
    jsonb_build_object('manual', true, 'reason', p_reason),
    'linked', now(), auth.uid()
  )
  returning id into v_recon_id;

  insert into public.payment_events (payment_intent_id, workspace_id, event_type, actor_type, actor_user_id, reason, evidence)
  values (p_intent_id, v_iws, 'reconciliation_linked', 'user', auth.uid(),
          coalesce(p_reason, 'Manually linked to a transaction'),
          jsonb_build_object('transaction_id', p_transaction_id, 'reconciliation_id', v_recon_id));

  perform public.apply_reconciliation_effects(v_recon_id);
end;
$$;

revoke all on function public.link_payment_manually(uuid, uuid, text) from public;
grant execute on function public.link_payment_manually(uuid, uuid, text) to authenticated;
