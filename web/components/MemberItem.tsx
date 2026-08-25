"use client";

import { useState, useTransition } from "react";
import { changeMemberRole, removeMember } from "../app/settings/workspace/actions";
import { Badge } from "./Badge";
import { formatDateTime } from "../lib/format";
import type { WorkspaceMemberRow, WorkspaceRole } from "../lib/queries";

const ROLE_OPTIONS: { value: WorkspaceRole; label: string }[] = [
  { value: "owner", label: "Owner" },
  { value: "admin", label: "Admin" },
  { value: "member", label: "Member" },
  { value: "viewer", label: "Viewer" },
];

export function MemberItem({
  member,
  canManage,
}: {
  member: WorkspaceMemberRow;
  canManage: boolean;
}) {
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const canEditThisRow = canManage && !member.isSelf;

  return (
    <div className="flex flex-col gap-2 rounded-card border border-border-subtle bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-text-primary">
          {member.isSelf ? "You" : `Member ${member.userId.slice(0, 8)}`}
        </span>
        {member.status === "invited" && <Badge variant="neutral">Invited</Badge>}
        {member.status === "suspended" && (
          <Badge variant="attention">Suspended</Badge>
        )}
      </div>

      <p className="text-xs text-text-muted">
        {member.joinedAt
          ? `Joined ${formatDateTime(member.joinedAt)}`
          : "Not yet joined"}
      </p>

      {canEditThisRow ? (
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <select
            value={member.role}
            disabled={isPending}
            onChange={(event) => {
              setErrorMessage(null);
              startTransition(async () => {
                const result = await changeMemberRole(
                  member.membershipId,
                  event.target.value,
                );
                if (!result.ok) setErrorMessage(result.error);
              });
            }}
            className="min-h-9 rounded-control border border-border-strong bg-background px-2 text-xs text-text-primary"
          >
            {ROLE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          {!confirmingRemove ? (
            <button
              type="button"
              onClick={() => setConfirmingRemove(true)}
              className="min-h-8 text-xs font-medium text-text-muted hover:text-attention"
            >
              Remove
            </button>
          ) : (
            <span className="flex items-center gap-2">
              <button
                type="button"
                disabled={isPending}
                onClick={() => {
                  setErrorMessage(null);
                  startTransition(async () => {
                    const result = await removeMember(member.membershipId);
                    if (!result.ok) {
                      setErrorMessage(result.error);
                      setConfirmingRemove(false);
                    }
                  });
                }}
                className="min-h-8 rounded-control bg-attention px-3 text-xs font-medium text-accent-foreground disabled:opacity-50"
              >
                {isPending ? "Removing…" : "Confirm remove"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmingRemove(false)}
                className="min-h-8 text-xs font-medium text-text-muted"
              >
                Cancel
              </button>
            </span>
          )}
        </div>
      ) : (
        <Badge variant="neutral">
          {ROLE_OPTIONS.find((option) => option.value === member.role)?.label ??
            member.role}
        </Badge>
      )}

      {errorMessage && (
        <p role="alert" className="text-xs text-attention">
          {errorMessage}
        </p>
      )}
    </div>
  );
}
