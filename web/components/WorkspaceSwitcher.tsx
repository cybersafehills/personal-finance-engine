"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { setActiveWorkspace } from "../app/settings/workspace/actions";
import type { WorkspaceKind, WorkspaceSummary } from "../lib/queries";

const KIND_LABELS: Record<WorkspaceKind, string> = {
  personal: "Personal",
  household: "Household",
  organization: "Organization",
};

/**
 * The Space selector inside the account menu. Rendered by ProfileMenu
 * only when the caller belongs to more than one Space. Each Space shows
 * its kind so "Personal" and a household of the same name are never
 * ambiguous; switching updates the whole app for the next request
 * (setActiveWorkspace cookie + router.refresh).
 */
export function WorkspaceSwitcher({
  workspaces,
  activeWorkspaceId,
  onNavigate,
}: {
  workspaces: WorkspaceSummary[];
  activeWorkspaceId: string | null;
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function switchTo(workspaceId: string) {
    if (workspaceId === activeWorkspaceId) return;
    startTransition(async () => {
      const result = await setActiveWorkspace(workspaceId);
      if (result.ok) router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <p className="px-1 text-xs font-semibold uppercase tracking-wide text-text-muted">
        Space
      </p>
      <ul className="flex flex-col gap-0.5" role="listbox" aria-label="Switch Space">
        {workspaces.map((workspace) => {
          const isActive = workspace.id === activeWorkspaceId;
          return (
            <li key={workspace.id}>
              <button
                type="button"
                role="option"
                aria-selected={isActive}
                disabled={isPending}
                onClick={() => switchTo(workspace.id)}
                className={`flex w-full items-center justify-between gap-2 rounded-control px-2 py-1.5 text-left text-sm disabled:opacity-50 ${
                  isActive
                    ? "bg-accent text-accent-foreground"
                    : "text-text-secondary hover:bg-background hover:text-text-primary"
                }`}
              >
                <span className="min-w-0 truncate font-medium">
                  {workspace.name}
                </span>
                <span
                  className={`shrink-0 text-xs ${
                    isActive ? "text-accent-foreground/80" : "text-text-muted"
                  }`}
                >
                  {KIND_LABELS[workspace.kind]}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <Link
        href="/settings/workspace"
        onClick={onNavigate}
        className="mt-0.5 rounded-control px-2 py-1.5 text-sm font-medium text-accent hover:bg-background"
      >
        Create a Space
      </Link>
    </div>
  );
}
