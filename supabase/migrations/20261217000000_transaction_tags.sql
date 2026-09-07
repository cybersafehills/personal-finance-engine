-- Free-form transaction tags (master prompt section 24 - "advanced
-- filters ... tag"). A tag is a short label a workspace member attaches
-- to a transaction ("reimbursable", "tax", "trip-nairobi"). The Financial
-- Statements engine can then scope a statement to a single tag; the
-- filtered document is clearly marked as such.
--
-- A tag is a plain member-managed row (like a categorization decision),
-- NOT part of any immutable snapshot: once a statement is generated its
-- statement_transactions rows are frozen, so re-tagging later never
-- changes an existing document.

create table public.transaction_tags (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null
    references public.transactions (id) on delete cascade,
  workspace_id uuid not null
    references public.workspaces (id) on delete cascade,
  -- Normalized on the way in (trimmed, lower-cased) by
  -- lib/transaction-tags.ts; capped so it stays a label, not a note.
  tag text not null check (char_length(tag) between 1 and 40),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),

  unique (transaction_id, tag)
);

comment on table public.transaction_tags is
  'Free-form member-applied labels on a transaction. Member-managed config, not snapshot data - re-tagging never mutates an already-generated statement. Consumed by the Financial Statements "tag" filter.';

create index idx_transaction_tags_txn
  on public.transaction_tags (transaction_id);
create index idx_transaction_tags_workspace_tag
  on public.transaction_tags (workspace_id, tag);

alter table public.transaction_tags enable row level security;

revoke all on public.transaction_tags from anon, authenticated;
grant select, insert, delete on public.transaction_tags to authenticated;
grant select, insert, update, delete on public.transaction_tags to service_role;

-- Any member of the workspace can see the tags (a viewer building a
-- filtered statement needs to read them); adding / removing a tag needs
-- at least the 'member' role, and the row's workspace must match the
-- tagged transaction's workspace.
create policy transaction_tags_select_member on public.transaction_tags
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy transaction_tags_insert_member on public.transaction_tags
  for insert to authenticated
  with check (
    public.is_workspace_member(workspace_id, 'member')
    and created_by = auth.uid()
    and exists (
      select 1 from public.transactions t
      where t.id = transaction_id and t.workspace_id = transaction_tags.workspace_id
    )
  );

create policy transaction_tags_delete_member on public.transaction_tags
  for delete to authenticated
  using (public.is_workspace_member(workspace_id, 'member'));
