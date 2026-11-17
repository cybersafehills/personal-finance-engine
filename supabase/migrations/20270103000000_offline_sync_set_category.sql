-- Offline category edits: idempotent, conflict-aware.
--
-- A device that changed a category offline sends the category it BELIEVED the
-- row had (base) and the one it wants. The server compares-and-sets on that
-- field only (not on updated_at, which ingestion also moves):
--   * current = base          -> apply (the normal case)
--   * current = wanted        -> already there; recorded as applied, no history noise
--   * anything else           -> 'conflict': nothing is changed, the server's
--                                current values are returned so the user can
--                                choose. p_force re-sends "keep mine" after that.
-- Applying reuses apply_manual_category_correction, so authorization (member+),
-- audit history and the manual-decision protection are exactly the web's.
-- Replays by op_id return the stored outcome. Conflicts are NOT stored (they
-- changed nothing), so a retry re-evaluates against the then-current row.

alter table public.client_operations drop constraint client_operations_op_type_check;
alter table public.client_operations
  add constraint client_operations_op_type_check
  check (op_type in ('create_manual_transaction', 'set_category'));

create or replace function public.sync_set_category(
  p_op_id uuid,
  p_transaction_id uuid,
  p_category text,
  p_subcategory text,
  p_base_category text,
  p_base_subcategory text,
  p_force boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_existing public.client_operations;
  v_txn public.transactions;
  v_cat text := nullif(btrim(coalesce(p_category, '')), '');
  v_sub text := nullif(btrim(coalesce(p_subcategory, '')), '');
  v_result jsonb;
begin
  if v_user is null then raise exception 'not_authenticated'; end if;
  if p_op_id is null or p_transaction_id is null then raise exception 'invalid_operation'; end if;
  if v_cat is null or char_length(v_cat) > 80 or char_length(coalesce(v_sub, '')) > 80 then
    raise exception 'invalid_text';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_op_id::text, 0));

  select * into v_existing from public.client_operations where op_id = p_op_id;
  if found then
    if v_existing.user_id <> v_user or v_existing.entity_id <> p_transaction_id then
      raise exception 'op_id_conflict';
    end if;
    return jsonb_set(v_existing.result, '{status}', '"replayed"');
  end if;

  -- Visible only to members (RLS is bypassed here, so check explicitly).
  select * into v_txn from public.transactions where id = p_transaction_id;
  if not found or not public.is_workspace_member(v_txn.workspace_id, 'member') then
    raise exception 'not_found_or_forbidden';
  end if;

  if not p_force
     and (v_txn.category is distinct from nullif(btrim(coalesce(p_base_category, '')), '')
          or v_txn.subcategory is distinct from nullif(btrim(coalesce(p_base_subcategory, '')), ''))
     and (v_txn.category is distinct from v_cat or v_txn.subcategory is distinct from v_sub) then
    return jsonb_build_object(
      'status', 'conflict',
      'server', jsonb_build_object(
        'category', v_txn.category, 'subcategory', v_txn.subcategory,
        'category_source', v_txn.category_source, 'updated_at', v_txn.updated_at));
  end if;

  if v_txn.category is distinct from v_cat or v_txn.subcategory is distinct from v_sub
     or v_txn.category_decision_status is distinct from 'confirmed' then
    select * into v_txn from public.apply_manual_category_correction(p_transaction_id, v_cat, v_sub);
  end if;

  v_result := jsonb_build_object('status', 'applied', 'id', p_transaction_id, 'server_updated_at', v_txn.updated_at);
  insert into public.client_operations (op_id, user_id, op_type, entity_id, result)
  values (p_op_id, v_user, 'set_category', p_transaction_id, v_result);
  return v_result;
end;
$$;

comment on function public.sync_set_category is
  'Idempotent offline category edit with field-level compare-and-set. Returns status applied | replayed | conflict (with the server values). Reuses apply_manual_category_correction for authorization and audit.';

revoke all on function public.sync_set_category(uuid, uuid, text, text, text, text, boolean) from public, anon;
grant execute on function public.sync_set_category(uuid, uuid, text, text, text, text, boolean) to authenticated;
