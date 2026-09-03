-- Integrations Phase 3, P3-PR2: let an authenticated workspace member READ
-- their own balance-reconciliation checkpoints.
--
-- balance_reconciliations (20260818130100) has existed, empty, since Phase
-- 3 with service-role-only access because nothing populated it and nothing
-- read it. The Reconciliation Center (P3-PR1) now surfaces a "balance
-- drift" section, and the P3-PR2 reconcile-balances edge function + the
-- run-balance-reconciliation cron populate the table. This migration adds
-- exactly one capability: a member of the owning account's workspace may
-- SELECT its rows. All writes stay service-role only - the canonical
-- reconciliation engine (supabase/functions/_shared/reconciliation.ts,
-- invoked by the edge function with the service role) remains the sole
-- writer, exactly as the table comment already promises.

-- account_id is nullable on this table, but every row the engine writes
-- carries one; a row with a null account_id (which the engine never
-- produces) simply stays invisible to authenticated, which is the safe
-- default.
create policy balance_reconciliations_select_member
  on public.balance_reconciliations
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.accounts a
      where a.id = balance_reconciliations.account_id
        and public.is_workspace_member(a.workspace_id)
    )
  );

grant select on public.balance_reconciliations to authenticated;

comment on policy balance_reconciliations_select_member
  on public.balance_reconciliations is
  'A workspace member may read reconciliation checkpoints for accounts in their workspace. INSERT/UPDATE/DELETE remain service-role only (the reconcile-balances edge function is the only writer).';
