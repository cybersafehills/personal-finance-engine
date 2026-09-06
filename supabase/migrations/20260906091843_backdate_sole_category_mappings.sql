-- Backdate first-ever category -> allocation mappings so they cover spend
-- that was already recorded when the user created them.
--
-- Until now web/app/budgets/categories/actions.ts always inserted
-- budget_category_mappings.effective_from = current_date. The budget
-- aggregation (web/lib/budget-math.ts aggregateOutflowsByAllocation)
-- matches a transaction to a mapping only when
-- effective_from <= occurred_at, so a mapping created today never applied
-- to earlier transactions in the same period - they stayed "unmapped",
-- allocations never accumulated, and the "N unmapped transactions" banner
-- never cleared. The action now backdates a category's FIRST mapping to
-- the epoch; this one-off repairs rows already saved with today's date.
--
-- Only rows that are the SOLE mapping for their (workspace_id, category)
-- are touched. If a category has ever been re-mapped (a closed row also
-- exists) its effective-dating is deliberate and left alone, keeping
-- closed budget periods reproducible.
--
-- Idempotent: the `effective_from > '1970-01-01'` guard makes a re-run a
-- no-op. Already applied to production out-of-band via the Supabase MCP
-- (recorded as version 20260906091843); this file lets a fresh
-- environment reproduce it and is skipped by `supabase db push` where it
-- is already recorded.

update public.budget_category_mappings m
   set effective_from = date '1970-01-01'
 where m.effective_until is null
   and m.effective_from > date '1970-01-01'
   and not exists (
     select 1
       from public.budget_category_mappings o
      where o.workspace_id = m.workspace_id
        and o.category = m.category
        and o.id <> m.id
   );
