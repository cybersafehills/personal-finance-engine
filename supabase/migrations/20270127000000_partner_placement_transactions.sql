-- A fifth sponsored placement: the Transactions tab (same slim bar as Plan).
-- Additive: widens the placement id check, seeds the row, and re-issues the one
-- setter whose id allow-list must know about it. Delivery stays OFF unless the
-- owner has turned it on; this only adds a slot the owner can switch off.

alter table public.partner_placements drop constraint if exists partner_placements_id_check;
alter table public.partner_placements
  add constraint partner_placements_id_check
  check (id in ('home', 'pay-person', 'pay-merchant', 'plan', 'transactions'));

insert into public.partner_placements (id, format) values ('transactions', 'bar')
  on conflict (id) do nothing;

create or replace function public.console_partner_placement_set(
  p_id text,
  p_enabled boolean,
  p_format text,
  p_mode text,
  p_interval_sec integer,
  p_loop boolean,
  p_offer_ids uuid[] default '{}'
)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_role text;
begin
  v_role := public.console_assert('manage_partners');
  if p_id not in ('home','pay-person','pay-merchant','plan','transactions') then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if p_format not in ('wide','square','tall','bar') or p_mode not in ('static','carousel')
     or p_interval_sec is null or p_interval_sec not between 3 and 30 then
    raise exception 'invalid_setting' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(coalesce(p_offer_ids, '{}')) x
             where not exists (select 1 from public.partner_offers where id = x and status = 'approved')) then
    raise exception 'offer_not_approved' using errcode = '22023';
  end if;
  update public.partner_placements
     set enabled = coalesce(p_enabled, enabled), format = p_format, mode = p_mode,
         interval_sec = p_interval_sec, loop = coalesce(p_loop, loop),
         offer_ids = coalesce(p_offer_ids, '{}'), updated_by = auth.uid(), updated_at = now()
   where id = p_id;
  perform public.console_audit_internal(v_role, 'partners.placement_updated', 'partner_placement', p_id, 'success',
    jsonb_build_object('enabled', p_enabled, 'format', p_format, 'mode', p_mode, 'interval_sec', p_interval_sec));
end;
$$;
