-- OneLedger 3.0 E7: one-off clean-up for tokens that were ingested BEFORE the
-- parser learned to strip them (docs/oneledger-3/e5-utility-tokens.md). A
-- "...with token 1234-5678-..." tail captured as a merchant label flowed into
-- display fields; this removes it, and masks the same 20-digit tokens in the
-- raw evidence. It is a FUNCTION, not an automatic step: service-role only,
-- DRY-RUN BY DEFAULT (counts only), idempotent, and it never touches a row that
-- does not match. Run it deliberately: select public.scrub_utility_tokens(false);

create or replace function public.scrub_utility_tokens(p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c_labels int; c_refs int; c_meta int; c_names int; c_idents int; c_msgs int; c_events int;
begin
  select count(*) into c_labels from public.transactions t
   where t.counterparty_name ~* '\ytoken\y' or t.counterparty_name ~ '\d{4}[-\s]\d{4}[-\s]\d{4}' or t.counterparty_name ~ '\d{12,}';
  select count(*) into c_refs from public.transactions t where t.counterparty_reference ~ '\d{16,}';
  select count(*) into c_meta from public.transactions t
   where (t.metadata->>'original_counterparty_name') ~* '\ytoken\y'
      or (t.metadata->>'original_counterparty_name') ~ '\d{4}[-\s]\d{4}[-\s]\d{4}'
      or (t.metadata->>'original_counterparty_name') ~ '\d{12,}';
  select count(*) into c_names from public.counterparties c
   where c.display_name ~* '\ytoken\y' or c.display_name ~ '\d{4}[-\s]\d{4}[-\s]\d{4}' or c.display_name ~ '\d{12,}';
  select count(*) into c_idents from public.counterparty_identifiers i
   where i.identifier_type = 'name_label'
     and (i.normalized_value ~* '\ytoken\y' or i.normalized_value ~ '\d{4}[-\s]\d{4}[-\s]\d{4}' or i.normalized_value ~ '\d{12,}');
  select count(*) into c_msgs from public.momo_messages m where m.raw_message ~ '\d{4}([-\s]\d{4}){4}';
  select count(*) into c_events from public.raw_financial_events e where (e.raw_payload->>'raw_message') ~ '\d{4}([-\s]\d{4}){4}';

  if not p_dry_run then
    update public.transactions t set counterparty_name = nullif(btrim(regexp_replace(regexp_replace(regexp_replace(t.counterparty_name, '\s*\y(with\s+)?token\y.*$', '', 'i'), '\d{4}([-\s]\d{4}){2,}([-\s]\d{1,4})?|\d{12,}', '', 'g'), '\s+', ' ', 'g')), '')
     where t.counterparty_name ~* '\ytoken\y' or t.counterparty_name ~ '\d{4}[-\s]\d{4}[-\s]\d{4}' or t.counterparty_name ~ '\d{12,}';
    update public.transactions t set counterparty_reference = null where t.counterparty_reference ~ '\d{16,}';
    update public.transactions t
       set metadata = jsonb_set(t.metadata, '{original_counterparty_name}',
         to_jsonb(coalesce(nullif(btrim(regexp_replace(regexp_replace(regexp_replace(t.metadata->>'original_counterparty_name', '\s*\y(with\s+)?token\y.*$', '', 'i'), '\d{4}([-\s]\d{4}){2,}([-\s]\d{1,4})?|\d{12,}', '', 'g'), '\s+', ' ', 'g')), ''), '')))
     where (t.metadata->>'original_counterparty_name') ~* '\ytoken\y'
        or (t.metadata->>'original_counterparty_name') ~ '\d{4}[-\s]\d{4}[-\s]\d{4}'
        or (t.metadata->>'original_counterparty_name') ~ '\d{12,}';
    update public.counterparties c set display_name = coalesce(nullif(left(btrim(regexp_replace(regexp_replace(regexp_replace(c.display_name, '\s*\y(with\s+)?token\y.*$', '', 'i'), '\d{4}([-\s]\d{4}){2,}([-\s]\d{1,4})?|\d{12,}', '', 'g'), '\s+', ' ', 'g')), 120), ''), 'Unknown')
     where c.display_name ~* '\ytoken\y' or c.display_name ~ '\d{4}[-\s]\d{4}[-\s]\d{4}' or c.display_name ~ '\d{12,}';
    -- a name-label identity built from a leaky label is dropped; the next
    -- backfill_counterparties re-resolves those transactions from the clean label
    delete from public.counterparty_identifiers i
     where i.identifier_type = 'name_label'
       and (i.normalized_value ~* '\ytoken\y' or i.normalized_value ~ '\d{4}[-\s]\d{4}[-\s]\d{4}' or i.normalized_value ~ '\d{12,}');
    update public.momo_messages m set raw_message = regexp_replace(m.raw_message, '\d{4}([-\s]\d{4}){4}', '[token removed]', 'g')
     where m.raw_message ~ '\d{4}([-\s]\d{4}){4}';
    update public.raw_financial_events e
       set raw_payload = jsonb_set(e.raw_payload, '{raw_message}', to_jsonb(regexp_replace(e.raw_payload->>'raw_message', '\d{4}([-\s]\d{4}){4}', '[token removed]', 'g')))
     where (e.raw_payload->>'raw_message') ~ '\d{4}([-\s]\d{4}){4}';
  end if;

  return jsonb_build_object(
    'dry_run', p_dry_run, 'transaction_labels', c_labels, 'transaction_references', c_refs,
    'transaction_metadata', c_meta, 'counterparty_names', c_names, 'name_label_identifiers', c_idents,
    'momo_messages', c_msgs, 'raw_events', c_events);
end;
$$;
revoke all on function public.scrub_utility_tokens(boolean) from public;
grant execute on function public.scrub_utility_tokens(boolean) to service_role;
comment on function public.scrub_utility_tokens is
  'One-off, service-role, dry-run-by-default clean-up of utility tokens that reached display fields or raw evidence before the parser stripped them. Idempotent.';
