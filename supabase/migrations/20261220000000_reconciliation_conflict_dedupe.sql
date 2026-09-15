-- Fix: reconcile_transaction_with_payment_intents inserted a fresh
-- payment_reconciliations 'conflict' row every time it ran for a
-- transaction whose ambiguity was still unresolved - the retry cron
-- (POST /api/cron/reconcile-pending-payments) re-evaluates every still-
-- open intent on every tick, so an unresolved ambiguous transaction
-- accumulated one new 'conflict' row per tick, indefinitely (surfaced as
-- dozens of near-identical "Payment reconciliation conflict" Inbox
-- cards for a single payment). The 'linked' path was already guarded by
-- the partial-unique indexes from Phase N (20260907000000); the
-- 'conflict' path had no equivalent guard.
--
-- Fix: skip the ambiguous branch entirely once ANY open (status =
-- 'conflict') row already exists for the transaction - there is nothing
-- new to record until a human resolves it (link_payment_manually
-- already rejects the stale conflict rows for an intent once it's
-- manually linked, so resolution still clears this correctly).
create or replace function public.reconcile_transaction_with_payment_intents(
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
  -- Already flagged and awaiting a human decision - re-running (e.g. the
  -- retry cron on its next tick) has nothing new to record.
  if exists (select 1 from public.payment_reconciliations r where r.transaction_id = p_transaction_id and r.status = 'conflict') then
    return jsonb_build_object('status', 'skipped', 'reason', 'already_flagged');
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

  -- Ambiguous: one conflict row per candidate, never a guess. Guarded
  -- above - this only ever runs once per transaction, the first time its
  -- ambiguity is discovered.
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

-- ===========================================================================
-- One-time cleanup: collapse the duplicate 'conflict' rows the bug above
-- already produced. For each (transaction_id, payment_intent_id) pair,
-- keep the earliest 'conflict' row and reject the later, redundant ones -
-- same effect the missing guard should have had from the start. Never
-- touches 'linked' or already-'rejected' rows.
-- ===========================================================================
with duplicate_conflicts as (
  select id,
         row_number() over (
           partition by transaction_id, payment_intent_id
           order by created_at asc
         ) as rn
  from public.payment_reconciliations
  where status = 'conflict'
)
update public.payment_reconciliations pr
set status = 'rejected',
    rejected_reason = 'duplicate: automatic cleanup (superseded by an identical earlier conflict row)'
from duplicate_conflicts d
where pr.id = d.id
  and d.rn > 1;
