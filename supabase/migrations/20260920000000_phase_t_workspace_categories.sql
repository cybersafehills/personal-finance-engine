-- Phase T (PR4): Space-aware category scope.
--
-- workspace_categories (Phase Q) exists but had no write RPCs and no
-- consumer. This migration routes its writes through two SECURITY DEFINER
-- RPCs - capability-gated and audited - matching the SELECT-only-for-
-- authenticated pattern used by space_activity / goal_participants /
-- transaction_member_attributions, and drops the direct admin write
-- policies. The web side adds a management surface under /categories and
-- offers these labels as suggestions in the category-correction form.
--
-- Categories remain free-text on transactions; workspace_categories is a
-- per-Space *vocabulary* (add / relabel / archive), orthogonal to the
-- platform set and to any member's Personal categories (master prompt §27).

-- ===========================================================================
-- Route writes through RPCs: drop the direct admin write policies and
-- revoke the corresponding grants. SELECT stays open to any member.
-- ===========================================================================

drop policy workspace_categories_insert_admin on public.workspace_categories;
drop policy workspace_categories_update_admin on public.workspace_categories;

revoke insert, update on public.workspace_categories from authenticated;

-- ===========================================================================
-- upsert_workspace_category: add or relabel one Space category.
-- category.manage-gated. Re-adding an archived key un-archives it.
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
  if not public.has_space_capability(p_workspace_id, 'category.manage') then
    raise exception 'You do not have permission to manage categories in this Space.';
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

revoke all on function public.upsert_workspace_category(uuid, text, text, text) from public;
grant execute on function public.upsert_workspace_category(uuid, text, text, text) to authenticated;

-- ===========================================================================
-- set_workspace_category_archived: archive (hide) or restore one category.
-- Never deletes - a category a transaction was tagged with stays valid.
-- ===========================================================================

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
  if not public.has_space_capability(p_workspace_id, 'category.manage') then
    raise exception 'You do not have permission to manage categories in this Space.';
  end if;

  update public.workspace_categories
  set is_archived = p_archived
  where workspace_id = p_workspace_id and key = p_key;

  if not found then
    raise exception 'That category does not exist in this Space.';
  end if;

  perform public.record_space_audit_event(
    p_workspace_id,
    case when p_archived then 'category.archived' else 'category.restored' end,
    'workspace_category', null, null, jsonb_build_object('key', p_key));
end;
$$;

revoke all on function public.set_workspace_category_archived(uuid, text, boolean) from public;
grant execute on function public.set_workspace_category_archived(uuid, text, boolean) to authenticated;
