-- directory_suggestions: bind workspace_id to the suggester's own workspaces.
--
-- The insert policy only required suggester_user_id = auth.uid(), so a signed-in
-- user could stamp a suggestion with ANOTHER tenant's workspace_id. Impact was
-- provenance only (rows are readable by the author and directory admins, so no
-- tenant data was exposed), but a tenant-scoped column must not be forgeable.
-- Found by the two-tenant isolation sweep (two_tenant_isolation.sql).
--
-- workspace_id stays nullable (a suggestion need not come from a workspace).
-- When set, the caller must be an active member. The web app already sends the
-- user's active workspace (web/app/pay/suggest/actions.ts), so legitimate
-- inserts are unchanged. Forward-only: the original migration is not edited.

drop policy if exists directory_suggestions_insert on public.directory_suggestions;

create policy directory_suggestions_insert on public.directory_suggestions
  for insert to authenticated
  with check (
    suggester_user_id = auth.uid()
    and (workspace_id is null or public.is_workspace_member(workspace_id))
  );
