-- Phase E (E1): schema foundation for the four remaining first-release
-- gaps that needed real schema changes - manual transaction entry (which
-- also unlocks live EUR/USD budget actuals, see below), split
-- transactions across allocations, and self-transfer linking.
--
-- Purely additive except one deliberate relaxation (momo_message_id
-- nullability, explained below) - no existing row is touched, no
-- existing column is retyped or dropped.

-- ===========================================================================
-- transactions.momo_message_id: relaxed from NOT NULL to nullable, with a
-- replacement CHECK that preserves the original guarantee for every
-- existing ingestion source. Every transaction that comes from MoMo SMS
-- ingestion still requires a momo_message_id exactly as before - only
-- source='manual' rows (a new source this migration doesn't itself
-- create; see the web/ manual-entry action) may have a null one, because
-- a manually entered transaction genuinely has no raw SMS message to
-- point at. momo_messages remains untouched and its own comment
-- ("immutable raw SMS evidence") stays accurate - manual entries are
-- never given a synthetic/fabricated momo_messages row.
-- ===========================================================================

alter table public.transactions
  alter column momo_message_id drop not null;

alter table public.transactions
  add constraint transactions_momo_message_required_unless_manual check (
    momo_message_id is not null or source = 'manual'
  );

comment on column public.transactions.momo_message_id is
  'Required for every ingested (MoMo SMS) transaction, exactly as before this migration. NULL only for source=''manual'' rows, which have no raw SMS message to reference - see transactions_momo_message_required_unless_manual.';

-- ===========================================================================
-- Note on manual EUR/USD actuals: amount_rwf/fee_rwf/principal_effect_rwf/
-- fee_effect_rwf/net_effect_rwf are NOT actually RWF-only despite their
-- names - they are integer minor units of whatever currency this row's
-- own `currency` column holds (RWF's minor unit happens to equal 1 whole
-- RWF, which is why this was never visible before: every existing row is
-- currency='RWF'). The `_rwf` suffix is a naming artifact from when RWF
-- was the only currency ever ingested, not a real constraint - the
-- generated net_effect_rwf expression and the budget aggregation in
-- web/lib/queries.ts already operate on these columns generically by
-- transaction currency. This migration does not rename these columns
-- (that would touch ingest-momo and the accounting engine for no
-- functional benefit) - it only makes the existing generality usable by
-- allowing a manual, non-RWF transaction to exist at all (via the
-- momo_message_id relaxation above). A EUR/USD budget's "live actuals"
-- gap is closed entirely by this and the web/ manual-entry UI - no
-- change to getBudgetActuals() itself was needed.
-- ===========================================================================

-- workspace_id+id unique target for the two composite FKs below, mirroring
-- accounts_workspace_id_id_unique (Phase C) and
-- budgets_workspace_id_id_unique (Phase D).
alter table public.transactions
  add constraint transactions_workspace_id_id_unique unique (workspace_id, id);

-- ===========================================================================
-- transaction_splits: divides one transaction's amount across multiple
-- budget allocations (e.g. a single grocery-run payment that is really
-- part essentials, part wants). A transaction with zero split rows is
-- unaffected - it continues to be assigned wholesale to its category's
-- mapped allocation, exactly as before this migration. A transaction
-- with any split rows is split-governed instead: the split rows'
-- allocation_type/amount_minor values are used in place of the
-- category-mapping lookup for that specific transaction.
-- ===========================================================================

create table public.transaction_splits (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions (id) on delete cascade,
  workspace_id uuid not null,
  allocation_type text not null
    check (allocation_type in ('ESSENTIALS', 'INVESTING', 'EMERGENCY', 'WANTS')),
  amount_minor bigint not null check (amount_minor > 0),
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  constraint transaction_splits_unique_type unique (transaction_id, allocation_type),
  constraint transaction_splits_transaction_same_workspace
    foreign key (workspace_id, transaction_id)
    references public.transactions (workspace_id, id)
);

create index idx_transaction_splits_transaction on public.transaction_splits (transaction_id);
create index idx_transaction_splits_workspace on public.transaction_splits (workspace_id);

comment on table public.transaction_splits is
  'Per-transaction override: divides one transaction''s amount across multiple allocation types. All-or-nothing per transaction, enforced by validate_transaction_splits_sum below - once any split row exists for a transaction, the full set must sum exactly to that transaction''s settled spend effect.';

-- Constraint trigger (DEFERRABLE INITIALLY DEFERRED, not a plain AFTER ROW
-- trigger) so a multi-row INSERT adding several split rows for the same
-- transaction in one statement is validated once, after every row of that
-- statement has landed - not rejected on the first row before the rest
-- have been inserted, which a plain FOR EACH ROW trigger would do.
create or replace function public.validate_transaction_splits_sum()
returns trigger
language plpgsql
as $$
declare
  target_transaction_id uuid := coalesce(new.transaction_id, old.transaction_id);
  splits_total bigint;
  txn_effect bigint;
begin
  select coalesce(sum(amount_minor), 0) into splits_total
  from public.transaction_splits
  where transaction_id = target_transaction_id;

  if splits_total = 0 then
    return null;
  end if;

  select abs(coalesce(principal_effect_rwf, 0) + coalesce(fee_effect_rwf, 0))
    into txn_effect
  from public.transactions
  where id = target_transaction_id;

  if txn_effect is null then
    raise exception
      'Cannot split transaction %: it has not been processed by the accounting engine yet',
      target_transaction_id
      using errcode = 'check_violation';
  end if;

  if splits_total <> txn_effect then
    raise exception
      'Transaction % splits total % but its settled effect is % - splits must sum exactly to the transaction amount',
      target_transaction_id, splits_total, txn_effect
      using errcode = 'check_violation';
  end if;

  return null;
end;
$$;

create constraint trigger validate_transaction_splits_total
  after insert or update or delete on public.transaction_splits
  deferrable initially deferred
  for each row execute function public.validate_transaction_splits_sum();

alter table public.transaction_splits enable row level security;

create policy transaction_splits_select_member on public.transaction_splits
  for select to authenticated
  using (public.is_workspace_member(workspace_id));
create policy transaction_splits_write_owner on public.transaction_splits
  for insert to authenticated
  with check (public.is_workspace_member(workspace_id, 'owner'));
create policy transaction_splits_update_owner on public.transaction_splits
  for update to authenticated
  using (public.is_workspace_member(workspace_id, 'owner'))
  with check (public.is_workspace_member(workspace_id, 'owner'));
create policy transaction_splits_delete_owner on public.transaction_splits
  for delete to authenticated
  using (public.is_workspace_member(workspace_id, 'owner'));

revoke all on public.transaction_splits from anon;
grant select, insert, update, delete on public.transaction_splits to authenticated;
grant select, insert, update, delete on public.transaction_splits to service_role;

-- ===========================================================================
-- transfer_links: a confirmed (or explicitly dismissed) pairing of an
-- outgoing and an incoming transaction believed to be the same money
-- moving between two of the user's own accounts. Never inferred
-- automatically at the database level - this project has no reliable
-- signal (no phone-number-to-account mapping) to prove two transactions
-- are a transfer, so a candidate pairing is only ever a heuristic
-- suggestion (computed in web/lib/queries.ts) that a human explicitly
-- confirms or dismisses. A 'linked' pair is excluded from budget
-- expenditure/income aggregation; a 'dismissed' pair is remembered only
-- so the same suggestion doesn't keep reappearing.
-- ===========================================================================

create table public.transfer_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  out_transaction_id uuid not null references public.transactions (id),
  in_transaction_id uuid not null references public.transactions (id),
  status text not null default 'linked' check (status in ('linked', 'dismissed')),
  linked_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  constraint transfer_links_different_transactions check (out_transaction_id <> in_transaction_id),
  constraint transfer_links_out_same_workspace
    foreign key (workspace_id, out_transaction_id)
    references public.transactions (workspace_id, id),
  constraint transfer_links_in_same_workspace
    foreign key (workspace_id, in_transaction_id)
    references public.transactions (workspace_id, id)
);

-- A transaction may be the confirmed OUT (or IN) side of at most one
-- active transfer link. Partial indexes so a 'dismissed' row never
-- blocks a later genuine 'linked' pairing of the same transaction with a
-- different counterpart.
create unique index idx_transfer_links_out_unique
  on public.transfer_links (out_transaction_id) where status = 'linked';
create unique index idx_transfer_links_in_unique
  on public.transfer_links (in_transaction_id) where status = 'linked';
create index idx_transfer_links_workspace on public.transfer_links (workspace_id);

alter table public.transfer_links enable row level security;

create policy transfer_links_select_member on public.transfer_links
  for select to authenticated
  using (public.is_workspace_member(workspace_id));
create policy transfer_links_write_owner on public.transfer_links
  for insert to authenticated
  with check (public.is_workspace_member(workspace_id, 'owner'));
create policy transfer_links_delete_owner on public.transfer_links
  for delete to authenticated
  using (public.is_workspace_member(workspace_id, 'owner'));

revoke all on public.transfer_links from anon;
grant select, insert, delete on public.transfer_links to authenticated;
grant select, insert, delete on public.transfer_links to service_role;
