-- OneLedger 3.0 E5: encrypted storage for sensitive bearer values found in
-- payment messages (a prepaid-electricity token, today). ADDITIVE.
--
-- The database stores ONLY ciphertext: encryption/decryption happens in the
-- application (supabase/functions/_shared/sensitive-crypto.ts, mirrored at
-- web/lib/sensitive-crypto.ts) with a key that exists only in the app/edge
-- environment - never in the database, its backups or its logs. So even a full
-- database read yields nothing usable.
--
-- Access model:
--   * written only by the ingest Edge Function (service role);
--   * NO direct access for authenticated or anon: the table has RLS enabled and
--     no policy, and no grant;
--   * the single read path is reveal_transaction_sensitive_detail(), which
--     checks the caller may see that exact transaction (workspace member+ AND
--     source visibility), rate-limits, writes an audit event, and returns the
--     SEALED value (key id, nonce, ciphertext) for the web/mobile server to
--     decrypt. An unauthorized caller gets the same error as "no such value".

create table public.transaction_sensitive_details (
  transaction_id uuid not null,
  workspace_id uuid not null,
  kind text not null check (kind in ('utility_token')),
  key_id text not null check (key_id ~ '^[A-Za-z0-9_-]{1,32}$'),
  nonce text not null check (length(nonce) between 8 and 64),
  ciphertext text not null check (length(ciphertext) between 16 and 2048),
  created_at timestamptz not null default now(),
  primary key (transaction_id, kind),
  constraint transaction_sensitive_details_txn_same_workspace
    foreign key (workspace_id, transaction_id)
    references public.transactions (workspace_id, id) on delete cascade
);
create index idx_transaction_sensitive_details_workspace on public.transaction_sensitive_details (workspace_id);

alter table public.transaction_sensitive_details enable row level security;
revoke all on public.transaction_sensitive_details from anon, authenticated;
grant select, insert, delete on public.transaction_sensitive_details to service_role;

comment on table public.transaction_sensitive_details is
  'Application-encrypted (AES-256-GCM) bearer values such as prepaid-electricity tokens. Ciphertext only; the key never touches the database. Service-role write; the only authenticated read path is reveal_transaction_sensitive_detail() (authorised, rate-limited, audited).';

create or replace function public.reveal_transaction_sensitive_detail(
  p_transaction_id uuid,
  p_kind text default 'utility_token'
)
returns table (key_id text, nonce text, ciphertext text)
language plpgsql
security definer
set search_path = public
as $$
declare
  t record;
  d public.transaction_sensitive_details%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select tx.workspace_id, tx.financial_source_id into t
  from public.transactions tx where tx.id = p_transaction_id;

  -- Same error for "no such transaction", "not yours", "cannot see this source"
  -- and "no sensitive value": no existence oracle.
  if not found
     or not public.is_workspace_member(t.workspace_id, 'member')
     or not public.can_view_source_in_space(t.financial_source_id, t.workspace_id) then
    raise exception 'sensitive_detail_not_found' using errcode = 'P0002';
  end if;

  select * into d from public.transaction_sensitive_details
  where transaction_id = p_transaction_id and kind = p_kind;
  if not found then
    raise exception 'sensitive_detail_not_found' using errcode = 'P0002';
  end if;

  -- 20 reveals / user / hour (counts successful reveals only).
  if (select count(*) from public.space_audit_events
        where actor_user_id = auth.uid()
          and event_type = 'transaction.sensitive_revealed'
          and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'rate_limited' using errcode = '54000';
  end if;

  perform public.record_space_audit_event(
    t.workspace_id, 'transaction.sensitive_revealed', 'transaction', p_transaction_id,
    null, jsonb_build_object('kind', p_kind));  -- never the value, never the ciphertext

  return query select d.key_id, d.nonce, d.ciphertext;
end;
$$;
revoke all on function public.reveal_transaction_sensitive_detail(uuid, text) from public;
grant execute on function public.reveal_transaction_sensitive_detail(uuid, text) to authenticated, service_role;
