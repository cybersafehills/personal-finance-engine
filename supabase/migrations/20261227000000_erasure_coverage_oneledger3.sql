-- OneLedger 3.0 E1: make account erasure (20261203000000_account_erasure.sql)
-- cover the 3.0 tables. Found by a failing-first test, not by inspection:
-- erasing a user whose Personal Space held a MATCHED payment request aborted,
-- because deleting the transaction nulled payment_requests.matched_transaction_id
-- and violated payment_requests_matched_consistent
-- ((status = 'matched') = (matched_transaction_id is not null)).
--
-- Fix, with no change to execute_account_deletion itself:
--  1. A request whose matched transaction is deleted has no meaning, so the
--     matched-transaction FK now CASCADES (events cascade from the request).
--     Transactions are never hard-deleted by the app; only erasure reaches this.
--  2. payment_requests.created_by now CASCADES from auth.users. A payment
--     request carries the creator's own destination number and name; deleting
--     the account must remove it from SHARED Spaces too (a plain SET NULL would
--     leave that personal data behind, orphaned). The public link then 404s.
-- Other 3.0 tables need nothing: counterparties / identifiers / merge events /
-- balance_observations / payment_request_events cascade from their workspace
-- (solo-workspace teardown) and their created_by-style columns are SET NULL
-- (the "who did it" attribution on shared-ledger facts, same as every other
-- shared table).

alter table public.payment_requests
  drop constraint payment_requests_matched_txn_same_workspace,
  add constraint payment_requests_matched_txn_same_workspace
    foreign key (workspace_id, matched_transaction_id)
    references public.transactions (workspace_id, id) on delete cascade;

alter table public.payment_requests
  drop constraint payment_requests_created_by_fkey,
  add constraint payment_requests_created_by_fkey
    foreign key (created_by) references auth.users (id) on delete cascade;

comment on column public.payment_requests.created_by is
  'Creator. ON DELETE CASCADE by design: the request holds the creator''s own destination and name, so account erasure removes it everywhere (see 20261227000000).';
