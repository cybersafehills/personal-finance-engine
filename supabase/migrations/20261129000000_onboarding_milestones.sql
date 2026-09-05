-- Release 3 (First Run): the persisted spine of the onboarding milestone
-- journey (ADR 0012). Most milestones are DERIVED from live signals
-- (a source exists, a device is paired, a connection has been verified, a
-- real transaction landed) so they survive a device change or a reinstall
-- with no stored state. The three that cannot be derived are recorded
-- here, per user, on the existing profiles row:
--
--   intent                 - the user's Personal / Household / Business
--                            choice (drives the experience mode, ADR 0011)
--   onboarding_first_review_at   - they acted on the first-transaction
--                                  review card
--   onboarding_first_insight_at  - they were shown their first insight
--
-- All additive and nullable; a missing value simply means "not yet".
-- Existing users are backfilled to intent = their personal workspace's
-- kind so an established account never re-enters first-run.

alter table public.profiles
  add column onboarding_intent text
    check (onboarding_intent is null
      or onboarding_intent in ('personal', 'household', 'business')),
  add column onboarding_intent_at timestamptz,
  add column onboarding_first_review_at timestamptz,
  add column onboarding_first_insight_at timestamptz,
  add constraint profiles_onboarding_intent_consistent
    check (
      (onboarding_intent is null and onboarding_intent_at is null)
      or (onboarding_intent is not null and onboarding_intent_at is not null)
    );

-- Backfill: an established user keeps whatever their personal workspace
-- already is. (kind is 'personal' | 'organization' | 'household'; the
-- journey treats 'organization' as the "business" intent - ADR 0011.)
update public.profiles p
set onboarding_intent = case w.kind
      when 'organization' then 'business'
      when 'household' then 'household'
      else 'personal'
    end,
    onboarding_intent_at = now()
from public.workspaces w
where w.created_by = p.id
  and w.kind = 'personal'
  and w.status = 'active'
  and p.onboarding_step = 'completed'
  and p.onboarding_intent is null;

comment on column public.profiles.onboarding_intent is
  'First-run intent: personal | household | business. Drives the experience mode (ADR 0011). NULL until the user chooses. Not an authorization boundary.';

-- set_onboarding_intent - the user records (or changes) their intent.
-- Idempotent: onboarding_intent_at is stamped once and then preserved, so
-- re-running or changing the choice never rewinds the "when did they
-- first decide" timestamp. Choosing 'household'/'business' does NOT create
-- a Space here - collaborative setup is deferred to its own milestone
-- (assessment section 25).
create or replace function public.set_onboarding_intent(p_intent text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_intent text := lower(btrim(p_intent));
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if v_intent not in ('personal', 'household', 'business') then
    raise exception 'Invalid onboarding intent';
  end if;

  update public.profiles
  set onboarding_intent = v_intent,
      onboarding_intent_at = coalesce(onboarding_intent_at, now())
  where id = auth.uid();

  if not found then raise exception 'Profile not found'; end if;
end;
$$;

-- mark_onboarding_milestone - stamps one of the UI-observed milestones
-- the first time it happens; a later call is a no-op (coalesce keeps the
-- original time). Only 'first_review' and 'first_insight' are accepted -
-- every other milestone is derived, never marked.
create or replace function public.mark_onboarding_milestone(p_milestone text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_milestone text := lower(btrim(p_milestone));
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;

  if v_milestone = 'first_review' then
    update public.profiles
    set onboarding_first_review_at = coalesce(onboarding_first_review_at, now())
    where id = auth.uid();
  elsif v_milestone = 'first_insight' then
    update public.profiles
    set onboarding_first_insight_at = coalesce(onboarding_first_insight_at, now())
    where id = auth.uid();
  else
    raise exception 'Unknown onboarding milestone';
  end if;

  if not found then raise exception 'Profile not found'; end if;
end;
$$;

revoke all on function public.set_onboarding_intent(text) from public;
revoke all on function public.mark_onboarding_milestone(text) from public;
grant execute on function public.set_onboarding_intent(text) to authenticated;
grant execute on function public.mark_onboarding_milestone(text) to authenticated;
