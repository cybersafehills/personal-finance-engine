"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setActiveWorkspace } from "../app/settings/workspace/actions";
import type { WorkspaceSummary } from "../lib/queries";

/**
 * Only rendered by AppShell when the caller belongs to more than one
 * workspace - a single-workspace user (the common case today) never sees
 * this at all, matching how the whole account bar is already absent
 * pre-auth.
 */
export function WorkspaceSwitcher({
  workspaces,
  activeWorkspaceId,
}: {
  workspaces: WorkspaceSummary[];
  activeWorkspaceId: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <select
      value={activeWorkspaceId ?? ""}
      disabled={isPending}
      onChange={(event) => {
        const workspaceId = event.target.value;
        startTransition(async () => {
          const result = await setActiveWorkspace(workspaceId);
          if (result.ok) router.refresh();
        });
      }}
      className="min-h-7 rounded-full border border-border-subtle bg-background px-2 py-0.5 text-xs text-text-secondary"
    >
      {workspaces.map((workspace) => (
        <option key={workspace.id} value={workspace.id}>
          {workspace.name}
        </option>
      ))}
    </select>
  );
}
