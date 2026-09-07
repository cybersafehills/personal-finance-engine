-- Scheduled Statements - weekly and quarterly cadences (in addition to
-- monthly, master prompt section 30). Additive columns on
-- statement_schedules; no new grant. `day_of_week` (0 = Sunday …
-- 6 = Saturday, matching JS getUTCDay) is used for weekly; `day_of_month`
-- for monthly and quarterly (quarterly = day N of Jan/Apr/Jul/Oct).

alter table public.statement_schedules
  add column cadence text not null default 'monthly'
    check (cadence in ('weekly', 'monthly', 'quarterly')),
  add column day_of_week integer
    check (day_of_week is null or day_of_week between 0 and 6);

comment on column public.statement_schedules.cadence is
  'weekly | monthly | quarterly. Determines both when the schedule fires (nextScheduledRunUtc) and the period the generated statement covers (last week / last month / last quarter).';
comment on column public.statement_schedules.day_of_week is
  '0 = Sunday … 6 = Saturday (JS getUTCDay). Set only for cadence = weekly; NULL otherwise, where day_of_month applies.';
