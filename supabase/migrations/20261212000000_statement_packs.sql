-- Financial Documents Engine - Statement Packs (master prompt section 32).
--
-- A pack bundles several already-generated statements into one ZIP for
-- sharing (accountant, lender, visa file). Additive: a new table plus the
-- existing private "statement-artifacts" bucket (path prefix "packs/").
-- Built synchronously by lib/statement-pack.ts (packs are a handful of
-- documents), so no worker. Same RLS posture as `statements`: authenticated
-- may SELECT + DELETE for members; the row is written by the service role
-- after membership + per-statement ownership have been verified.

create table public.statement_packs (
  id uuid primary key default gen_random_uuid(),
  pack_id text not null
    constraint statement_packs_pack_id_format
      check (pack_id ~ '^OL-PK-[0-9]{8}-[0-9A-HJ-NP-Z]{6}$'),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null,
  -- The statements bundled, in order. Not an FK (Postgres cannot FK array
  -- elements); every id is verified against `statements` RLS in the app.
  statement_ids uuid[] not null,
  title text check (title is null or length(title) <= 120),
  format text not null default 'zip' check (format = 'zip'),
  -- Relative to the private "statement-artifacts" bucket ("packs/<id>.zip").
  storage_path text,
  checksum text,
  byte_size bigint check (byte_size is null or byte_size > 0),
  item_count integer not null default 0 check (item_count >= 0),
  status text not null default 'generating'
    check (status in ('generating', 'ready', 'failed')),
  failure_reason text,
  generated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.statement_packs is
  'A downloadable ZIP bundle of several generated statements (Financial Documents Engine, master prompt section 32). storage_path is relative to the private "statement-artifacts" bucket. Written by the service role (lib/statement-pack.ts) after ownership of every listed statement is verified; authenticated may SELECT + DELETE for workspace members only.';

create unique index statement_packs_pack_id_key
  on public.statement_packs (pack_id);
create index idx_statement_packs_workspace_created
  on public.statement_packs (workspace_id, created_at desc);

create trigger set_statement_packs_updated_at
  before update on public.statement_packs
  for each row execute function public.set_updated_at();

alter table public.statement_packs enable row level security;

revoke all on public.statement_packs from anon, authenticated;
grant select, delete on public.statement_packs to authenticated;
grant select, insert, update, delete on public.statement_packs to service_role;

create policy statement_packs_select_member on public.statement_packs
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy statement_packs_delete_member on public.statement_packs
  for delete to authenticated
  using (public.is_workspace_member(workspace_id, 'member'));
