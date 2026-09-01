-- Resumable first-run profile and financial-preferences onboarding.
-- Existing users are considered complete so this rollout never forces an
-- established account back through first-run setup. New profiles inherit the
-- final `profile` default from handle_new_user's existing insert.

alter table public.profiles
  add column first_name text,
  add column last_name text,
  add column country_code char(2),
  add column onboarding_step text not null default 'profile',
  add column onboarding_completed_at timestamptz;

alter table public.profiles
  add constraint profiles_first_name_length
    check (first_name is null or char_length(first_name) between 1 and 80),
  add constraint profiles_last_name_length
    check (last_name is null or char_length(last_name) between 1 and 80),
  add constraint profiles_country_code_format
    check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  add constraint profiles_onboarding_step_valid
    check (onboarding_step in ('profile', 'preferences', 'setup', 'completed')),
  add constraint profiles_onboarding_completion_consistent
    check (
      (onboarding_step = 'completed' and onboarding_completed_at is not null)
      or (onboarding_step <> 'completed' and onboarding_completed_at is null)
    );

update public.profiles
set onboarding_step = 'completed', onboarding_completed_at = now();

comment on column public.profiles.onboarding_step is
  'Resumable first-run stage. setup is the optional connection/manual-start choice; completed users are never forced back through onboarding.';

create or replace function public.save_onboarding_profile(
  p_first_name text,
  p_last_name text,
  p_country_code text,
  p_locale text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_first_name text := nullif(btrim(p_first_name), '');
  v_last_name text := nullif(btrim(p_last_name), '');
  v_country_code text := upper(btrim(p_country_code));
  v_locale text := lower(btrim(p_locale));
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if v_first_name is null or char_length(v_first_name) > 80 then
    raise exception 'First name must be between 1 and 80 characters';
  end if;
  if v_last_name is not null and char_length(v_last_name) > 80 then
    raise exception 'Last name must be 80 characters or fewer';
  end if;
  if v_country_code !~ '^[A-Z]{2}$' then raise exception 'Invalid country'; end if;
  if v_locale not in ('en', 'fr') then raise exception 'Invalid locale'; end if;

  update public.profiles
  set first_name = v_first_name,
      last_name = v_last_name,
      display_name = concat_ws(' ', v_first_name, v_last_name),
      country_code = v_country_code,
      locale = v_locale,
      onboarding_step = case when onboarding_step = 'completed' then 'completed' else 'preferences' end
  where id = auth.uid();

  if not found then raise exception 'Profile not found'; end if;
end;
$$;

create or replace function public.save_onboarding_preferences(
  p_preferred_currency text,
  p_timezone text,
  p_locale text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_currency text := upper(btrim(p_preferred_currency));
  v_timezone text := btrim(p_timezone);
  v_locale text := lower(btrim(p_locale));
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if v_currency !~ '^[A-Z]{3}$' then raise exception 'Invalid currency'; end if;
  if not exists (select 1 from pg_timezone_names where name = v_timezone) then
    raise exception 'Invalid timezone';
  end if;
  if v_locale not in ('en', 'fr') then raise exception 'Invalid locale'; end if;

  update public.profiles
  set preferred_currency = v_currency,
      timezone = v_timezone,
      locale = v_locale,
      onboarding_step = case when onboarding_step = 'completed' then 'completed' else 'setup' end
  where id = auth.uid();

  if not found then raise exception 'Profile not found'; end if;

  update public.workspaces
  set default_currency = v_currency, timezone = v_timezone
  where kind = 'personal' and created_by = auth.uid() and status = 'active';
end;
$$;

create or replace function public.complete_profile_onboarding()
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles
  set onboarding_step = 'completed', onboarding_completed_at = coalesce(onboarding_completed_at, now())
  where id = auth.uid();
$$;

revoke all on function public.save_onboarding_profile(text, text, text, text) from public;
revoke all on function public.save_onboarding_preferences(text, text, text) from public;
revoke all on function public.complete_profile_onboarding() from public;
grant execute on function public.save_onboarding_profile(text, text, text, text) to authenticated;
grant execute on function public.save_onboarding_preferences(text, text, text) to authenticated;
grant execute on function public.complete_profile_onboarding() to authenticated;
