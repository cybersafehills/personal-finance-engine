-- Workspace category management for every workspace owner.
--
-- Phase T PR4 (20260920000000_phase_t_workspace_categories.sql) gated
-- upsert_workspace_category / set_workspace_category_archived on
-- has_space_capability(workspace_id, 'category.manage') - a capability a
-- Personal workspace never holds, so a solo user could not create or edit
-- a category at all. This migration:
--
--   1. Relaxes both gates to also allow a workspace owner
--      (is_workspace_member(workspace_id, 'owner')), so the category
--      vocabulary is available on a Personal workspace too. Space
--      households are unchanged - the capability still grants it there.
--   2. Adds rename_workspace_category(), which relabels one category AND
--      cascades the new label onto every transaction, categorization
--      policy and budget-category mapping in that workspace that carried
--      the old label - categories are free text on transactions, so a
--      rename that did not cascade would orphan the old string.
--
-- Per-row transaction_category_history rows are intentionally NOT written
-- for a bulk rename: it is a label correction across the workspace, not a
-- re-classification of any individual transaction. One space_audit_events
-- row records the rename and the number of rows touched.

-- ===========================================================================
-- 1. Relaxed gates. Bodies are otherwise identical to the Phase T PR4
--    definitions (key format check, label check, audit event).
-- ===========================================================================

create or replace function public.upsert_workspace_category(
  p_workspace_id uuid,
  p_key text,
  p_label text,
  p_parent_key text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (
    public.has_space_capability(p_workspace_id, 'category.manage')
    or public.is_workspace_member(p_workspace_id, 'owner')
  ) then
    raise exception 'You do not have permission to manage categories in this workspace.';
  end if;

  if p_key !~ '^[a-z0-9][a-z0-9_-]{0,48}$' then
    raise exception 'A category key must be 1-49 lowercase letters, digits, hyphens or underscores.';
  end if;

  if length(trim(both from coalesce(p_label, ''))) = 0 then
    raise exception 'A category needs a label.';
  end if;

  insert into public.workspace_categories
    (workspace_id, key, label, parent_key, is_archived, created_by)
  values
    (p_workspace_id, p_key, trim(both from p_label), p_parent_key, false, auth.uid())
  on conflict (workspace_id, key) do update
    set label = excluded.label,
        parent_key = excluded.parent_key,
        is_archived = false;

  perform public.record_space_audit_event(
    p_workspace_id, 'category.upserted', 'workspace_category', null, null,
    jsonb_build_object('key', p_key, 'label', trim(both from p_label)));
end;
$$;

create or replace function public.set_workspace_category_archived(
  p_workspace_id uuid,
  p_key text,
  p_archived boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (
    public.has_space_capability(p_workspace_id, 'category.manage')
    or public.is_workspace_member(p_workspace_id, 'owner')
  ) then
    raise exception 'You do not have permission to manage categories in this workspace.';
  end if;

  update public.workspace_categories
  set is_archived = p_archived
  where workspace_id = p_workspace_id and key = p_key;

  if not found then
    raise exception 'That category does not exist in this workspace.';
  end if;

  perform public.record_space_audit_event(
    p_workspace_id,
    case when p_archived then 'category.archived' else 'category.restored' end,
    'workspace_category', null, null, jsonb_build_object('key', p_key));
end;
$$;

-- ===========================================================================
-- 2. rename_workspace_category: relabel + cascade.
-- ===========================================================================

create or replace function public.rename_workspace_category(
  p_workspace_id uuid,
  p_key text,
  p_new_label text,
  p_new_parent_key text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_label text;
  v_new_label text := trim(both from coalesce(p_new_label, ''));
  v_rows integer := 0;
  v_delta integer;
begin
  if not (
    public.has_space_capability(p_workspace_id, 'category.manage')
    or public.is_workspace_member(p_workspace_id, 'owner')
  ) then
    raise exception 'You do not have permission to manage categories in this workspace.';
  end if;

  if length(v_new_label) = 0 then
    raise exception 'A category needs a label.';
  end if;

  select label into v_old_label
  from public.workspace_categories
  where workspace_id = p_workspace_id and key = p_key;

  if v_old_label is null then
    raise exception 'That category does not exist in this workspace.';
  end if;

  -- Labels must stay unambiguous - the cascade below matches transactions
  -- by label string, so two categories cannot share one.
  if exists (
    select 1 from public.workspace_categories
    where workspace_id = p_workspace_id
      and key <> p_key
      and is_archived = false
      and lower(label) = lower(v_new_label)
  ) then
    raise exception 'Another category in this workspace is already called "%".', v_new_label;
  end if;

  update public.workspace_categories
  set label = v_new_label, parent_key = p_new_parent_key
  where workspace_id = p_workspace_id and key = p_key;

  if v_old_label is distinct from v_new_label then
    update public.transactions
    set category = v_new_label
    where workspace_id = p_workspace_id and category = v_old_label;
    get diagnostics v_delta = row_count; v_rows := v_rows + v_delta;

    update public.categorization_policies
    set category = v_new_label
    where workspace_id = p_workspace_id and category = v_old_label;
    get diagnostics v_delta = row_count; v_rows := v_rows + v_delta;

    update public.budget_category_mappings
    set category = v_new_label
    where workspace_id = p_workspace_id and category = v_old_label;
    get diagnostics v_delta = row_count; v_rows := v_rows + v_delta;
  end if;

  perform public.record_space_audit_event(
    p_workspace_id, 'category.renamed', 'workspace_category', null,
    jsonb_build_object('key', p_key, 'label', v_old_label),
    jsonb_build_object('key', p_key, 'label', v_new_label, 'rows_recategorized', v_rows));
end;
$$;

revoke all on function public.rename_workspace_category(uuid, text, text, text) from public;
grant execute on function public.rename_workspace_category(uuid, text, text, text) to authenticated;
