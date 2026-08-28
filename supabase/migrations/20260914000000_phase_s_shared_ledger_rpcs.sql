-- Phase S (PR1): the shared-ledger mutation surface - the RPCs a household
-- member actually calls to share a source into a Space, move a transaction
-- between Spaces, and say whose spending a household transaction was.
--
-- Design of record: docs/oneledger-spaces-design.md (Phase S row).
-- Builds on Phase Q (source model + visibility) and Phase R (capability
-- primitive + audit/activity helpers).
--
-- Additive: one table + its validation trigger, five SECURITY DEFINER
-- RPCs. No existing row is modified. This is the backend for the Phase S
-- web UI (household onboarding, the "How should this account be used?"
-- sheet, the transaction provenance/attribution panel) - that UI is a
-- separate PR. Still no behaviour change for personal/organization
-- workspaces: every RPC below refuses a non-household target.

-- ===========================================================================
-- transaction_member_attributions: for attribution_type='split' - divides
-- one household transaction's "who spent this" across members in basis
-- points. Parallel to transaction_splits (Phase E), which is a different
-- axis (budget-allocation buckets, not people). A transaction with zero
-- rows here is attributed wholesale by transactions.attribution_type /
-- attributed_user_id; any rows here mean it is split.
-- ===========================================================================

create table public.transaction_member_attributions (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions (id) on delete cascade,
  workspace_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  share_bps integer not null check (share_bps between 1 and 10000),
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  constraint transaction_member_attributions_unique unique (transaction_id, user_id),
  constraint transaction_member_attributions_txn_same_workspace
    foreign key (workspace_id, transaction_id)
    references public.transactions (workspace_id, id)
);

comment on table public.transaction_member_attributions is
  'Per-member "who spent this" split for a household transaction, in basis points (10000 = 100%). All-or-nothing per transaction: once any row exists the set must total exactly 10000, enforced by validate_transaction_member_attributions below. Written only by set_transaction_attribution().';

create index idx_transaction_member_attributions_transaction
  on public.transaction_member_attributions (transaction_id);
create index idx_transaction_member_attributions_workspace
  on public.transaction_member_attributions (workspace_id);

-- Same deferrable-constraint-trigger shape as Phase E's
-- validate_transaction_splits_sum: validated once, after every row of a
-- multi-row statement has landed, and a zero total (all rows deleted)
-- is a valid "not split" state, not a violation.
create or replace function public.validate_transaction_member_attributions()
returns trigger
language plpgsql
as $$
declare
  target_transaction_id uuid := coalesce(new.transaction_id, old.transaction_id);
  bps_total integer;
begin
  select coalesce(sum(share_bps), 0) into bps_total
  from public.transaction_member_attributions
  where transaction_id = target_transaction_id;

  if bps_total = 0 then
    return null;
  end if;

  if bps_total <> 10000 then
    raise exception
      'Transaction % member-attribution shares total % bps but must total exactly 10000 (100%%)',
      target_transaction_id, bps_total
      using errcode = 'check_violation';
  end if;

  return null;
end;
$$;

revoke all on function public.validate_transaction_member_attributions() from public;

create constraint trigger validate_transaction_member_attributions_total
  after insert or update or delete on public.transaction_member_attributions
  deferrable initially deferred
  for each row execute function public.validate_transaction_member_attributions();

alter table public.transaction_member_attributions enable row level security;

-- Visible to anyone who can see the underlying transaction in this Space
-- (co-members need to see how a shared expense was split). Written only
-- through set_transaction_attribution() - no authenticated write policy.
create policy transaction_member_attributions_select
  on public.transaction_member_attributions
  for select to authenticated
  using (
    public.can_view_source_in_space(
      (select t.financial_source_id from public.transactions t where t.id = transaction_id),
      workspace_id)
  );

revoke all on public.transaction_member_attributions from anon;
grant select on public.transaction_member_attributions to authenticated;
grant select, insert, update, delete
  on public.transaction_member_attributions to service_role;

-- ===========================================================================
-- Source-visibility mutation RPCs. All owner-of-the-source only. The
-- "ceiling" ordering personal_only < share_transactions < share_account is
-- inlined as a CASE in each place it is needed.
-- ===========================================================================

-- set_source_visibility: the owner sets the maximum a source may ever
-- expose to any Space. Narrowing cascades: -> personal_only revokes every
-- active share link; -> share_transactions downgrades any share_account
-- link. One audit row per affected Space (a source with no shares is a
-- purely private change and writes nothing).
create or replace function public.set_source_visibility(
  p_source_id uuid,
  p_visibility_mode text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old text;
  v_link record;
begin
  if p_visibility_mode not in ('personal_only', 'share_transactions', 'share_account') then
    raise exception 'Unknown visibility mode: %', p_visibility_mode;
  end if;

  if not public.owns_financial_source(p_source_id) then
    raise exception 'Only the owner of a financial source can change its sharing.';
  end if;

  select visibility_mode into v_old from public.financial_sources where id = p_source_id;

  update public.financial_sources
  set visibility_mode = p_visibility_mode
  where id = p_source_id;

  -- Cascade to existing links when narrowing.
  if p_visibility_mode = 'personal_only' then
    for v_link in
      select workspace_id from public.source_space_links
      where financial_source_id = p_source_id and status = 'active'
    loop
      update public.source_space_links
      set status = 'revoked'
      where financial_source_id = p_source_id and workspace_id = v_link.workspace_id;

      perform public.record_space_audit_event(
        v_link.workspace_id, 'source.sharing_revoked', 'financial_source', p_source_id,
        jsonb_build_object('reason', 'owner set source to personal_only'), null);
      perform public.record_space_activity(
        v_link.workspace_id, 'source.unshared',
        'A shared account was made private', 'financial_source', p_source_id);
    end loop;

  elsif p_visibility_mode = 'share_transactions' then
    for v_link in
      select workspace_id from public.source_space_links
      where financial_source_id = p_source_id
        and status = 'active'
        and visibility_mode = 'share_account'
    loop
      update public.source_space_links
      set visibility_mode = 'share_transactions'
      where financial_source_id = p_source_id and workspace_id = v_link.workspace_id;

      perform public.record_space_audit_event(
        v_link.workspace_id, 'source.visibility_narrowed', 'financial_source', p_source_id,
        jsonb_build_object('mode', 'share_account'),
        jsonb_build_object('mode', 'share_transactions'));
    end loop;
  end if;
end;
$$;

revoke all on function public.set_source_visibility(uuid, text) from public;
grant execute on function public.set_source_visibility(uuid, text) to authenticated;

-- allocate_source_to_space: the "How should this account be used?" action.
-- Owner shares (or re-shares, or changes the per-link mode of) their
-- source into one household Space. Bumps the source's own ceiling up to at
-- least the requested mode so a single call is all the UI needs.
create or replace function public.allocate_source_to_space(
  p_source_id uuid,
  p_workspace_id uuid,
  p_visibility_mode text,
  p_is_default boolean default false,
  p_effective_from timestamptz default now()
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind text;
  v_status text;
  v_ceiling text;
begin
  if p_visibility_mode not in ('share_transactions', 'share_account') then
    raise exception 'A share link must be share_transactions or share_account.';
  end if;

  if not public.owns_financial_source(p_source_id) then
    raise exception 'Only the owner of a financial source can share it.';
  end if;

  if not public.is_workspace_member(p_workspace_id, 'member') then
    raise exception 'You must be a member of that Space to share a source into it.';
  end if;

  select kind, status into v_kind, v_status from public.workspaces where id = p_workspace_id;
  if v_kind is null then
    raise exception 'Space not found.';
  end if;
  if v_kind <> 'household' then
    raise exception 'Per-source sharing applies only to household Spaces.';
  end if;
  if v_status <> 'active' then
    raise exception 'That Space is not active.';
  end if;

  -- Raise the source's own ceiling if this link needs more than it currently allows.
  select visibility_mode into v_ceiling from public.financial_sources where id = p_source_id;
  if v_ceiling = 'personal_only'
     or (v_ceiling = 'share_transactions' and p_visibility_mode = 'share_account') then
    update public.financial_sources set visibility_mode = p_visibility_mode where id = p_source_id;
  end if;

  if p_is_default then
    update public.source_space_links
    set is_default_target = false
    where financial_source_id = p_source_id and is_default_target;
  end if;

  insert into public.source_space_links
    (financial_source_id, workspace_id, visibility_mode, is_default_target,
     effective_from, status, created_by)
  values
    (p_source_id, p_workspace_id, p_visibility_mode, p_is_default,
     p_effective_from, 'active', auth.uid())
  on conflict (financial_source_id, workspace_id) do update
    set visibility_mode = excluded.visibility_mode,
        is_default_target = excluded.is_default_target,
        effective_from = excluded.effective_from,
        status = 'active',
        updated_at = now();

  perform public.record_space_audit_event(
    p_workspace_id, 'source.shared', 'financial_source', p_source_id, null,
    jsonb_build_object('visibility_mode', p_visibility_mode, 'is_default', p_is_default));
  perform public.record_space_activity(
    p_workspace_id, 'source.shared',
    'A financial source was shared with this Space', 'financial_source', p_source_id);
end;
$$;

revoke all on function public.allocate_source_to_space(uuid, uuid, text, boolean, timestamptz) from public;
grant execute on function public.allocate_source_to_space(uuid, uuid, text, boolean, timestamptz) to authenticated;

-- set_source_space_link_status: pause / resume / revoke one share link.
-- Owner-only. Pausing or revoking immediately hides Space-allocated
-- history from non-owning members (the Phase Q RLS already keys off
-- status='active').
create or replace function public.set_source_space_link_status(
  p_source_id uuid,
  p_workspace_id uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old text;
begin
  if p_status not in ('active', 'paused', 'revoked') then
    raise exception 'A share link status must be active, paused, or revoked.';
  end if;

  if not public.owns_financial_source(p_source_id) then
    raise exception 'Only the owner of a financial source can change its sharing.';
  end if;

  select status into v_old from public.source_space_links
  where financial_source_id = p_source_id and workspace_id = p_workspace_id;

  if v_old is null then
    raise exception 'That source is not shared with that Space.';
  end if;

  update public.source_space_links
  set status = p_status, updated_at = now()
  where financial_source_id = p_source_id and workspace_id = p_workspace_id;

  perform public.record_space_audit_event(
    p_workspace_id, 'source.sharing_' || p_status, 'financial_source', p_source_id,
    jsonb_build_object('status', v_old), jsonb_build_object('status', p_status));
  perform public.record_space_activity(
    p_workspace_id, 'source.sharing_changed',
    'A source''s sharing was set to ' || p_status, 'financial_source', p_source_id);
end;
$$;

revoke all on function public.set_source_space_link_status(uuid, uuid, text) from public;
grant execute on function public.set_source_space_link_status(uuid, uuid, text) to authenticated;

-- ===========================================================================
-- set_transaction_attribution: household only. Records whose spending a
-- transaction represents - shared, one member, a basis-point split across
-- members, or unassigned. transaction.categorize capability + source
-- visibility required. Never guesses a member.
-- ===========================================================================

create or replace function public.set_transaction_attribution(
  p_transaction_id uuid,
  p_attribution_type text,
  p_attributed_user_id uuid default null,
  p_splits jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws uuid;
  v_src uuid;
  v_kind text;
  v_attr_user uuid := null;
  v_bad_member integer;
begin
  select workspace_id, financial_source_id into v_ws, v_src
  from public.transactions where id = p_transaction_id;
  if not found then
    raise exception 'Transaction not found.';
  end if;

  select kind into v_kind from public.workspaces where id = v_ws;
  if v_kind <> 'household' then
    raise exception 'Attribution applies only to household transactions.';
  end if;

  if not public.can_view_source_in_space(v_src, v_ws) then
    raise exception 'You cannot see this transaction.';
  end if;
  if not public.has_space_capability(v_ws, 'transaction.categorize') then
    raise exception 'You do not have permission to categorize transactions in this Space.';
  end if;

  if p_attribution_type not in ('shared', 'member', 'split', 'unassigned') then
    raise exception 'Unknown attribution type: %', p_attribution_type;
  end if;

  delete from public.transaction_member_attributions where transaction_id = p_transaction_id;

  if p_attribution_type = 'member' then
    if p_attributed_user_id is null then
      raise exception 'A member attribution needs a member.';
    end if;
    if not exists (
      select 1 from public.workspace_memberships
      where workspace_id = v_ws and user_id = p_attributed_user_id and status = 'active'
    ) then
      raise exception 'That person is not an active member of this Space.';
    end if;
    v_attr_user := p_attributed_user_id;

  elsif p_attribution_type = 'split' then
    if p_splits is null or jsonb_typeof(p_splits) <> 'array' then
      raise exception 'A split attribution needs an array of {user_id, share_bps}.';
    end if;

    insert into public.transaction_member_attributions
      (transaction_id, workspace_id, user_id, share_bps, created_by)
    select
      p_transaction_id, v_ws,
      (e ->> 'user_id')::uuid,
      (e ->> 'share_bps')::integer,
      auth.uid()
    from jsonb_array_elements(p_splits) e;

    select count(*) into v_bad_member
    from public.transaction_member_attributions a
    where a.transaction_id = p_transaction_id
      and not exists (
        select 1 from public.workspace_memberships m
        where m.workspace_id = v_ws and m.user_id = a.user_id and m.status = 'active'
      );
    if v_bad_member > 0 then
      raise exception 'A split names % person(s) who are not active members of this Space.', v_bad_member;
    end if;
    -- The 10000-bps total is enforced by the deferrable constraint trigger
    -- at statement end.
  end if;

  update public.transactions
  set attribution_type = p_attribution_type,
      attributed_user_id = v_attr_user,
      allocation_status = 'allocated'
  where id = p_transaction_id;

  perform public.record_space_audit_event(
    v_ws, 'transaction.attribution_changed', 'transaction', p_transaction_id, null,
    jsonb_build_object('attribution_type', p_attribution_type,
                       'attributed_user_id', v_attr_user));
end;
$$;

revoke all on function public.set_transaction_attribution(uuid, text, uuid, jsonb) from public;
grant execute on function public.set_transaction_attribution(uuid, text, uuid, jsonb) to authenticated;

-- ===========================================================================
-- reallocate_transaction: move one transaction from the Space it is in to
-- another Space where its source is visible. v1 deliberately refuses a
-- transaction that carries Space-scoped derived data (a budget split, a
-- transfer link, a goal contribution, a payment match) - those belong to
-- the old Space and must be resolved first. The common case (a
-- freshly-ingested transaction that landed in the wrong Space) has none.
-- ===========================================================================

create or replace function public.reallocate_transaction(
  p_transaction_id uuid,
  p_target_workspace_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cur_ws uuid;
  v_src uuid;
  v_occurred timestamptz;
  v_tstatus text;
  v_tkind text;
  v_link record;
  v_blockers integer;
begin
  select workspace_id, financial_source_id, occurred_at
    into v_cur_ws, v_src, v_occurred
  from public.transactions where id = p_transaction_id;
  if not found then
    raise exception 'Transaction not found.';
  end if;

  if v_cur_ws = p_target_workspace_id then
    return;  -- no-op
  end if;

  if not public.has_space_capability(v_cur_ws, 'transaction.categorize') then
    raise exception 'You do not have permission to move this transaction.';
  end if;
  if not public.is_workspace_member(p_target_workspace_id, 'member') then
    raise exception 'You must be a member of the destination Space.';
  end if;
  if not public.can_view_source_in_space(v_src, p_target_workspace_id) then
    raise exception 'This transaction''s account is not available in the destination Space.';
  end if;

  select status, kind into v_tstatus, v_tkind
  from public.workspaces where id = p_target_workspace_id;
  if v_tstatus <> 'active' then
    raise exception 'The destination Space is not active.';
  end if;

  if v_tkind = 'household' then
    select * into v_link from public.source_space_links
    where financial_source_id = v_src and workspace_id = p_target_workspace_id and status = 'active';
    if not found then
      raise exception 'Share this account with the destination Space before moving transactions into it.';
    end if;
    if v_link.effective_from > v_occurred then
      raise exception 'This transaction predates when the account was shared with that Space.';
    end if;
  end if;

  select
    (select count(*) from public.transaction_splits where transaction_id = p_transaction_id)
    + (select count(*) from public.transfer_links
       where (out_transaction_id = p_transaction_id or in_transaction_id = p_transaction_id)
         and status = 'linked')
    + (select count(*) from public.payment_reconciliations
       where transaction_id = p_transaction_id and status = 'linked')
    + (select count(*) from public.goal_contributions where transaction_id = p_transaction_id)
  into v_blockers;

  if v_blockers > 0 then
    raise exception
      'Resolve this transaction''s budget split, transfer link, goal contribution, or payment match before moving it.';
  end if;

  delete from public.transaction_member_attributions where transaction_id = p_transaction_id;

  update public.transactions
  set workspace_id = p_target_workspace_id,
      attribution_type = null,
      attributed_user_id = null,
      allocation_status = case when v_tkind = 'household' then 'needs_attribution' else 'allocated' end
  where id = p_transaction_id;

  perform public.record_space_audit_event(
    v_cur_ws, 'transaction.reallocated_out', 'transaction', p_transaction_id,
    jsonb_build_object('to_workspace', p_target_workspace_id), null);
  perform public.record_space_audit_event(
    p_target_workspace_id, 'transaction.reallocated_in', 'transaction', p_transaction_id,
    null, jsonb_build_object('from_workspace', v_cur_ws));
  perform public.record_space_activity(
    p_target_workspace_id, 'transaction.moved',
    'A transaction was moved into this Space', 'transaction', p_transaction_id);
end;
$$;

revoke all on function public.reallocate_transaction(uuid, uuid) from public;
grant execute on function public.reallocate_transaction(uuid, uuid) to authenticated;
