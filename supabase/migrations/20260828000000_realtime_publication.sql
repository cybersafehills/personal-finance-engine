-- Adds every table the app's live views read to the supabase_realtime
-- publication, so Postgres changes stream to subscribed clients over
-- Realtime's websocket. This is purely a replication concern - it does
-- NOT bypass RLS: Realtime evaluates each subscriber's own postgres_changes
-- filter against the table's existing RLS policies (transactions_select_member
-- and friends, all from the Phase B/C/D/E migrations), so a client only ever
-- receives change events for rows it could already SELECT. The workspace_id
-- column present on every one of these tables is what the browser client
-- (web/components/LiveDataSync.tsx) filters its subscription on.
alter publication supabase_realtime add table public.transactions;
alter publication supabase_realtime add table public.accounts;
alter publication supabase_realtime add table public.transaction_splits;
alter publication supabase_realtime add table public.transfer_links;
alter publication supabase_realtime add table public.budgets;
alter publication supabase_realtime add table public.budget_allocations;
alter publication supabase_realtime add table public.budget_category_mappings;
alter publication supabase_realtime add table public.financial_goals;
alter publication supabase_realtime add table public.goal_contributions;
