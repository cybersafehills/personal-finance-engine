-- Platform Console: customer directory (metadata only).
--
-- Returns one row per profile with NON-financial metadata: masked customer
-- reference, display name, account status, registration date, number of active
-- workspace memberships, highest assigned plan tier, and the timestamp of the
-- most recent transaction recorded in any of the customer's workspaces
-- ("last activity" - a timestamp only; no amounts, descriptions or counts).
-- No email, phone or contact data is returned. Requires view_customer_metadata.
-- Keyset pagination on (created_at, id).

create function public.console_customer_directory(
  p_search text default null,
  p_status text default null,
  p_limit integer default 25,
  p_before_created timestamptz default null,
  p_before_id uuid default null
)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
  stable
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 25), 100));
  v_search text := nullif(btrim(p_search), '');
  v_result jsonb;
begin
  perform public.console_assert('view_customer_metadata');

  if p_status is not null and p_status not in ('active', 'suspended') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(row_to_json(c) order by c.created_at desc, c.id desc), '[]'::jsonb)
  into v_result
  from (
    select
      p.id,
      left(p.id::text, 8) as customer_ref,
      p.display_name,
      p.status,
      p.created_at,
      (select count(*) from public.workspace_memberships m
        where m.user_id = p.id and m.status = 'active') as workspaces,
      (select wp.plan
         from public.workspace_memberships m
         join public.workspace_plans wp on wp.workspace_id = m.workspace_id
        where m.user_id = p.id and m.status = 'active'
        order by case wp.plan
                   when 'business' then 4 when 'household' then 3
                   when 'personal_plus' then 2 else 1 end desc
        limit 1) as top_plan,
      (select max(t.created_at)
         from public.workspace_memberships m
         join public.transactions t on t.workspace_id = m.workspace_id
        where m.user_id = p.id and m.status = 'active') as last_activity
    from public.profiles p
    where (p_status is null or p.status = p_status)
      and (v_search is null
           or p.id::text like lower(replace(replace(v_search, '%', ''), '_', '')) || '%'
           or p.display_name ilike '%' || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%')
      and (p_before_created is null
           or (p.created_at, p.id) < (p_before_created, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
    order by p.created_at desc, p.id desc
    limit v_limit
  ) c;
  return v_result;
end;
$$;

revoke all on function public.console_customer_directory(text, text, integer, timestamptz, uuid) from public;
grant execute on function public.console_customer_directory(text, text, integer, timestamptz, uuid) to authenticated;
