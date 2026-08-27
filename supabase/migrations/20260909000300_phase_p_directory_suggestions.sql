-- Phase P (P4): user suggestions for the directory + the moderation RPC.
--
-- service_code_reports (Phase M, extended for routes in P3) covers "this
-- existing entry is wrong". This adds directory_suggestions for NEW
-- submissions - suggest a code / a route / updated menu steps / a fee or
-- limit difference. Everything here enters a moderation queue and is
-- NEVER auto-published (brief section 10): there is no authenticated
-- write path to any directory-content table, and this table's own status
-- is only ever advanced by admin_resolve_directory_suggestion, which is
-- directory.resolve_reports-gated.
--
-- Insert is rate-limited to <=5 open per user per rolling hour by a
-- BEFORE INSERT trigger, mirroring enforce_service_code_report_rate_limit.

create table public.directory_suggestions (
  id uuid primary key default gen_random_uuid(),
  suggester_user_id uuid not null references auth.users (id) on delete cascade,
  workspace_id uuid references public.workspaces (id) on delete set null,
  suggestion_type text not null check (suggestion_type in (
    'new_service', 'new_route', 'menu_update', 'fee_limit_diff', 'other'
  )),
  -- Optional pointers to what the suggestion is about. Free-text network
  -- slug / institution name so a user can suggest something not yet in
  -- the directory at all.
  target_service_code_id uuid references public.service_codes (id) on delete set null,
  target_access_route_id uuid references public.access_routes (id) on delete set null,
  payment_network_slug text,
  institution_name text,
  channel text check (channel is null or channel in (
    'ussd', 'mobile_app', 'internet_banking', 'provider_website', 'qr', 'other'
  )),
  device text,
  last_tested_date date,
  body text not null check (length(trim(both from body)) > 0),

  status text not null default 'open' check (status in (
    'open', 'reviewing', 'accepted', 'declined', 'duplicate', 'needs_more_info'
  )),
  -- When accepted/linked, point at the record (and its version) the
  -- suggestion fed into - never a silent publish.
  linked_service_code_id uuid references public.service_codes (id) on delete set null,
  linked_access_route_id uuid references public.access_routes (id) on delete set null,
  resolution_note text,
  resolved_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

comment on table public.directory_suggestions is
  'User-submitted NEW directory content (codes / routes / menu steps / fee-limit differences). Moderation queue only - never auto-published. Insert is rate-limited (<=5 open per user per rolling hour). A suggester sees only their own rows; a directory.resolve_reports holder triages all.';

create index idx_directory_suggestions_status on public.directory_suggestions (status, created_at desc);
create index idx_directory_suggestions_suggester on public.directory_suggestions (suggester_user_id, created_at desc);

-- Rate-limit guard: at most 5 still-open suggestions per user in any
-- rolling hour. SECURITY INVOKER - the suggester can see their own rows
-- via RLS, which is all the count needs.
create function public.enforce_directory_suggestion_rate_limit()
returns trigger
language plpgsql
as $$
declare
  recent_count integer;
begin
  select count(*) into recent_count
  from public.directory_suggestions
  where suggester_user_id = new.suggester_user_id
    and status = 'open'
    and created_at > now() - interval '1 hour';

  if recent_count >= 5 then
    raise exception 'rate_limited: too many open suggestions from this user in the last hour'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_directory_suggestion_rate_limit() from public;

create trigger enforce_directory_suggestion_rate_limit
  before insert on public.directory_suggestions
  for each row execute function public.enforce_directory_suggestion_rate_limit();

-- Triage RPC. directory.resolve_reports-gated. Advances status, records
-- who/when/why, optionally links the record the suggestion fed into, and
-- writes an audit event. Never publishes anything itself.
create function public.admin_resolve_directory_suggestion(
  p_id uuid,
  p_status text,
  p_note text default null,
  p_linked_service_code_id uuid default null,
  p_linked_access_route_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before jsonb;
begin
  if not public.has_directory_permission('directory.resolve_reports') then
    raise exception 'not_authorized: directory.resolve_reports required' using errcode = 'insufficient_privilege';
  end if;

  if p_status not in ('open', 'reviewing', 'accepted', 'declined', 'duplicate', 'needs_more_info') then
    raise exception 'invalid_status: %', p_status using errcode = 'check_violation';
  end if;

  select to_jsonb(s.*) into v_before from public.directory_suggestions s where id = p_id;
  if v_before is null then
    raise exception 'not_found: directory_suggestion %', p_id using errcode = 'no_data_found';
  end if;

  update public.directory_suggestions set
    status = p_status,
    resolution_note = coalesce(p_note, resolution_note),
    linked_service_code_id = coalesce(p_linked_service_code_id, linked_service_code_id),
    linked_access_route_id = coalesce(p_linked_access_route_id, linked_access_route_id),
    resolved_by = case when p_status in ('accepted', 'declined', 'duplicate') then auth.uid() else resolved_by end,
    resolved_at = case when p_status in ('accepted', 'declined', 'duplicate') then now() else null end
  where id = p_id;

  perform public.record_directory_audit(
    'directory_suggestion.triage', 'directory_suggestion', p_id, v_before,
    (select to_jsonb(s.*) from public.directory_suggestions s where s.id = p_id), p_note
  );
end;
$$;

revoke all on function public.admin_resolve_directory_suggestion(uuid, text, text, uuid, uuid) from public;
grant execute on function public.admin_resolve_directory_suggestion(uuid, text, text, uuid, uuid) to authenticated;

-- ===========================================================================
-- RLS + grants
-- ===========================================================================
alter table public.directory_suggestions enable row level security;

create policy directory_suggestions_select on public.directory_suggestions
  for select to authenticated
  using (
    suggester_user_id = auth.uid()
    or public.has_directory_permission('directory.resolve_reports')
    or public.has_directory_permission('directory.view_admin')
  );

create policy directory_suggestions_insert on public.directory_suggestions
  for insert to authenticated
  with check (suggester_user_id = auth.uid());

revoke all on public.directory_suggestions from anon;
grant select, insert on public.directory_suggestions to authenticated;
grant all on public.directory_suggestions to service_role;
