"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { signOut } from "../app/login/actions";
import { UserIcon } from "./icons";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import type { WorkspaceSummary } from "../lib/queries";

/**
 * The single top-right "account" entry point in the unified application
 * shell header, on every device size (see AppShell) - email, workspace
 * switcher, settings shortcuts, and sign-out all live behind one control
 * rather than being spread across the header or a separate account bar,
 * per the master prompt's unified-shell requirement. Sign-out
 * deliberately has no permanent visual prominence in the header itself.
 */
export function ProfileMenu({
  userEmail,
  workspaces,
  activeWorkspaceId,
}: {
  userEmail: string;
  workspaces: WorkspaceSummary[];
  activeWorkspaceId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const triggerRef = useRef<HTMLButtonElement>(null);

  const activeWorkspaceName =
    workspaces.length > 1
      ? (workspaces.find((w) => w.id === activeWorkspaceId)?.name ?? null)
      : null;

  // Escape-to-close, with focus returned to the trigger - the click-
  // outside backdrop below handles the mouse case, this handles the
  // keyboard one (master prompt §3.1/§13).
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <div className="relative flex items-center gap-2">
      {activeWorkspaceName && (
        <span
          className="hidden max-w-[9rem] truncate rounded-full border border-border-subtle bg-background px-2.5 py-1 text-xs font-medium text-text-secondary sm:inline"
          title={`Current Space: ${activeWorkspaceName}`}
        >
          {activeWorkspaceName}
        </span>
      )}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Account menu"
        aria-expanded={open}
        className="flex h-11 w-11 items-center justify-center rounded-full border border-border-subtle bg-surface text-text-secondary transition-colors hover:bg-background"
      >
        <UserIcon className="h-5 w-5" />
      </button>

      {open && (
        <>
          {/* Click-outside backdrop - transparent, just closes the panel. */}
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-10 cursor-default"
          />
          <div className="absolute right-0 top-11 z-20 w-64 rounded-card border border-border-subtle bg-surface p-3 shadow-lg">
            <p className="truncate text-sm font-medium text-text-primary">
              {userEmail}
            </p>
            {workspaces.length > 1 && (
              <div className="mt-3 border-t border-border-subtle pt-2">
                <WorkspaceSwitcher
                  workspaces={workspaces}
                  activeWorkspaceId={activeWorkspaceId}
                  onNavigate={() => setOpen(false)}
                />
              </div>
            )}
            <div className="mt-3 flex flex-col gap-1 border-t border-border-subtle pt-2">
              <Link
                href="/settings"
                onClick={() => setOpen(false)}
                className="rounded-control px-2 py-2 text-sm font-medium text-text-secondary hover:bg-background hover:text-text-primary"
              >
                Settings
              </Link>
              <Link
                href="/settings/appearance"
                onClick={() => setOpen(false)}
                className="rounded-control px-2 py-2 text-sm font-medium text-text-secondary hover:bg-background hover:text-text-primary"
              >
                Appearance and navigation
              </Link>
              <Link
                href="/settings/privacy"
                onClick={() => setOpen(false)}
                className="rounded-control px-2 py-2 text-sm font-medium text-text-secondary hover:bg-background hover:text-text-primary"
              >
                Privacy and security
              </Link>
              <button
                type="button"
                onClick={() => startTransition(() => signOut())}
                disabled={isPending}
                className="rounded-control px-2 py-2 text-left text-sm font-medium text-text-secondary hover:bg-background hover:text-text-primary disabled:opacity-50"
              >
                {isPending ? "Signing out…" : "Sign out"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
