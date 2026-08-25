-- Phase 1 (auth hardening): per-account login lockout.
--
-- Supabase Auth already rate-limits sign-in/sign-up per IP
-- (auth.rate_limit.sign_in_sign_ups in supabase/config.toml), but that
-- does nothing against a targeted credential-stuffing attempt spread
-- across many IPs against one account. This adds an app-level,
-- per-email failed-attempt ledger the login Server Action consults
-- before ever calling Supabase Auth.
--
-- auth_login_attempts is service-role only, same as every other
-- privileged table in this schema: no RLS policies are needed because
-- neither anon nor authenticated ever receives a grant on it. It has to
-- be reachable pre-authentication (the request is still `anon` at the
-- point a login is being attempted), which is exactly what service_role
-- access from a trusted server context is for.

create table public.auth_login_attempts (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  succeeded boolean not null,
  created_at timestamptz not null default now()
);

comment on table public.auth_login_attempts is
  'Append-only login-attempt ledger for the app-level per-account lockout in web/app/login/actions.ts. Service-role only - never exposed to anon or authenticated.';

create index idx_auth_login_attempts_email_created
  on public.auth_login_attempts (lower(email), created_at desc);

revoke all on public.auth_login_attempts from anon, authenticated;
grant select, insert on public.auth_login_attempts to service_role;

-- ===========================================================================
-- recent_failed_login_count: how many failed attempts email has racked up
-- within p_window. security definer + stable, same shape as
-- is_workspace_member() in 20260821000000_phase_b_identity_and_tenancy.sql.
-- ===========================================================================

create or replace function public.recent_failed_login_count(
  p_email text,
  p_window interval
)
returns integer
language sql
security definer
set search_path = public
stable
as $$
  select count(*)::integer
  from public.auth_login_attempts
  where lower(email) = lower(p_email)
    and succeeded = false
    and created_at > now() - p_window;
$$;

comment on function public.recent_failed_login_count is
  'Failed sign-in count for p_email within p_window, used by the login Server Action to decide whether to lock out further attempts before calling Supabase Auth at all.';

revoke all on function public.recent_failed_login_count(text, interval) from public;
grant execute on function public.recent_failed_login_count(text, interval) to service_role;

-- ===========================================================================
-- record_login_attempt: appends one row after every real sign-in attempt.
-- ===========================================================================

create or replace function public.record_login_attempt(
  p_email text,
  p_succeeded boolean
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.auth_login_attempts (email, succeeded)
  values (p_email, p_succeeded);
$$;

comment on function public.record_login_attempt is
  'Records the outcome of one sign-in attempt. Called by web/app/login/actions.ts after every Supabase Auth signInWithPassword call, success or failure.';

revoke all on function public.record_login_attempt(text, boolean) from public;
grant execute on function public.record_login_attempt(text, boolean) to service_role;
