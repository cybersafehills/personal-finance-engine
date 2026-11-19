-- Hardening: profiles.is_platform_admin is service-controlled.
--
-- A BEFORE UPDATE trigger rejects changes to the flag from signed-in user
-- sessions (auth.uid() is not null). service_role, the SQL editor and
-- migrations (no JWT subject) are unaffected. Other profile columns stay
-- user-editable.
create or replace function public.protect_platform_admin_flag()
  returns trigger
  language plpgsql
  set search_path = public
as $$
begin
  if new.is_platform_admin is distinct from old.is_platform_admin
     and auth.uid() is not null then
    raise exception 'is_platform_admin can only be changed by the service role'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.protect_platform_admin_flag() from public;

create trigger protect_platform_admin_flag
  before update of is_platform_admin on public.profiles
  for each row execute function public.protect_platform_admin_flag();
