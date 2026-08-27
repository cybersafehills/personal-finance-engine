-- Phase P (P3 support): let the per-user favourite / recent-usage / report
-- tables point at an access_route as well as a service_code.
--
-- The Phase M tables were service_code-only. The public eKash route
-- finder (P3) needs "Save to favourites" and "Report a problem" on an
-- access_route that may have no linked USSD code at all. Each row now
-- targets EXACTLY ONE of service_code_id / access_route_id.
--
-- Purely additive: service_code_id becomes nullable, a nullable
-- access_route_id is added, a one-target CHECK is enforced, and the
-- favourites uniqueness moves to two partial indexes. No table, function,
-- grant, or RLS-policy count changes (the existing user_id = auth.uid()
-- policies already cover the new column). Reversible.

-- --- service_favourites --------------------------------------------------
alter table public.service_favourites
  alter column service_code_id drop not null;
alter table public.service_favourites
  add column if not exists access_route_id uuid references public.access_routes (id) on delete cascade;
alter table public.service_favourites
  drop constraint if exists service_favourites_unique;
alter table public.service_favourites
  add constraint service_favourites_one_target check (
    (service_code_id is not null and access_route_id is null) or
    (service_code_id is null and access_route_id is not null)
  );

create unique index if not exists service_favourites_unique_code
  on public.service_favourites (user_id, service_code_id) where service_code_id is not null;
create unique index if not exists service_favourites_unique_route
  on public.service_favourites (user_id, access_route_id) where access_route_id is not null;
create index if not exists idx_service_favourites_route
  on public.service_favourites (access_route_id) where access_route_id is not null;

comment on column public.service_favourites.access_route_id is
  'Set (with service_code_id NULL) when the favourite is an access_route rather than a standalone USSD code. Enforced one-or-the-other by service_favourites_one_target.';

-- --- service_recent_usage ---------------------------------------------
alter table public.service_recent_usage
  alter column service_code_id drop not null;
alter table public.service_recent_usage
  add column if not exists access_route_id uuid references public.access_routes (id) on delete cascade;
alter table public.service_recent_usage
  add constraint service_recent_usage_one_target check (
    (service_code_id is not null and access_route_id is null) or
    (service_code_id is null and access_route_id is not null)
  );

create index if not exists idx_service_recent_usage_route
  on public.service_recent_usage (access_route_id) where access_route_id is not null;

-- --- service_code_reports -------------------------------------------
alter table public.service_code_reports
  alter column service_code_id drop not null;
alter table public.service_code_reports
  add column if not exists access_route_id uuid references public.access_routes (id) on delete cascade;
alter table public.service_code_reports
  add constraint service_code_reports_one_target check (
    (service_code_id is not null and access_route_id is null) or
    (service_code_id is null and access_route_id is not null)
  );

create index if not exists idx_service_code_reports_route
  on public.service_code_reports (access_route_id) where access_route_id is not null;

comment on column public.service_code_reports.access_route_id is
  'Set (with service_code_id NULL) when the report is about an access_route. The <=5 open-per-hour rate limit (enforce_service_code_report_rate_limit) and the reporter-only RLS are unchanged.';
