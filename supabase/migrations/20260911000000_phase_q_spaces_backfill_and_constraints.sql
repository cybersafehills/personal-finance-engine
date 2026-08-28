-- Phase Q backfill: give every existing account a person-owned
-- financial_sources row, link them, and propagate the link onto the
-- account's transactions.
--
-- Companion to 20260910000000_phase_q_spaces_foundation.sql. Kept separate
-- so the additive schema can bake in production before this
-- data-modifying step - the same Phase B identity/backfill and Phase 3
-- accounting-column split.
--
-- Idempotent and retryable: every write is guarded by
-- `financial_source_id is null`, so a re-run after a partial application
-- is a no-op over already-linked rows.
--
-- Deliberately does NOT add a NOT NULL constraint to
-- accounts.financial_source_id or transactions.financial_source_id. Both
-- are backfilled to completeness here for every row that exists today, but
-- the application's own account-creation and ingestion write paths do not
-- set the column yet - tightening it now would break them. A NULL is
-- harmless for personal/organization workspaces (can_view_source_in_space
-- collapses to is_workspace_member there). Phase S (account creation
-- through the source model) and Phase U (ingestion cutover) add the
-- respective NOT NULL constraints once every writer populates the column.

-- ===========================================================================
-- One financial_sources row per existing account, owned by that
-- workspace's active owner. accounts.provider is one of mtn_momo / bank /
-- card / cash / other (its Phase 3 CHECK) - every value maps cleanly onto
-- the financial_sources provider + source_type enums. A DO-block loop
-- rather than a set-based statement because each account needs its own
-- freshly-returned source id written back onto it and its transactions;
-- production has a single-digit account count, so the loop is trivial and
-- unambiguous (same reasoning as the Phase B backfill's explicit form).
-- ===========================================================================

do $$
declare
  a record;
  v_owner uuid;
  v_provider text;
  v_source_type text;
  v_status text;
  v_source_id uuid;
  v_unlinked_remaining integer;
begin
  for a in
    select * from public.accounts where financial_source_id is null
  loop
    select m.user_id
      into v_owner
    from public.workspace_memberships m
    where m.workspace_id = a.workspace_id
      and m.role = 'owner'
      and m.status = 'active'
    order by m.joined_at nulls last, m.created_at
    limit 1;

    if v_owner is null then
      raise exception
        'Phase Q backfill: account % (workspace %) has no active owner membership to attribute a financial_sources row to',
        a.id, a.workspace_id;
    end if;

    v_provider := case a.provider
      when 'mtn_momo' then 'mtn_momo'
      when 'bank' then 'bank'
      when 'card' then 'card'
      when 'cash' then 'cash'
      else 'other'
    end;

    v_source_type := case a.provider
      when 'mtn_momo' then 'mobile_money'
      when 'bank' then 'bank_account'
      when 'card' then 'card'
      when 'cash' then 'cash'
      else 'import'
    end;

    v_status := case when a.archived_at is not null then 'archived' else 'active' end;

    insert into public.financial_sources
      (owner_user_id, provider, source_type, display_name, currency, status, created_by, created_at)
    values
      (v_owner, v_provider, v_source_type, a.name, a.currency, v_status, v_owner, a.created_at)
    returning id into v_source_id;

    update public.accounts
      set financial_source_id = v_source_id
      where id = a.id;

    update public.transactions
      set financial_source_id = v_source_id
      where account_id = a.id
        and financial_source_id is null;
  end loop;

  select count(*) into v_unlinked_remaining
  from public.accounts
  where financial_source_id is null;

  if v_unlinked_remaining <> 0 then
    raise exception
      'Phase Q backfill: % account(s) still have no financial_source_id after the backfill loop',
      v_unlinked_remaining;
  end if;
end $$;

comment on column public.accounts.financial_source_id is
  'The person-owned financial_sources row this account represents within its Space. Backfilled 1:1 from pre-Phase-Q accounts. Nullable until Phase S routes account creation through the source model, then NOT NULL.';
comment on column public.transactions.financial_source_id is
  'The person-owned financial_sources row this transaction came from. Backfilled from account_id for pre-Phase-Q rows where present; nullable until Phase U''s ingestion cutover sets it on every write path.';
