"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setGoalParticipants } from "../app/budgets/goals/actions";
import type { SpaceMember } from "../lib/queries";

function memberLabel(m: SpaceMember, selfUserId: string | null): string {
  if (m.displayName) return m.displayName;
  if (m.userId === selfUserId) return "You";
  return "A member";
}

export function GoalParticipants({
  goalId,
  members,
  participantUserIds,
  canManage,
  selfUserId,
}: {
  goalId: string;
  members: SpaceMember[];
  participantUserIds: string[];
  canManage: boolean;
  selfUserId: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(participantUserIds),
  );

  const participants = members.filter((m) => participantUserIds.includes(m.userId));

  function save() {
    setErrorMessage(null);
    startTransition(async () => {
      const result = await setGoalParticipants(goalId, Array.from(checked));
      if (!result.ok) {
        setErrorMessage(result.error);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  return (
    <section
      aria-label="Goal participants"
      className="mb-4 rounded-card border border-border-subtle bg-surface p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
          Participants
        </p>
        {canManage && !editing && (
          <button
            type="button"
            onClick={() => {
              setChecked(new Set(participantUserIds));
              setErrorMessage(null);
              setEditing(true);
            }}
            className="text-xs font-medium text-accent hover:underline"
          >
            Edit
          </button>
        )}
      </div>

      {!editing && (
        <p className="mt-1.5 text-sm text-text-primary">
          {participants.length === 0
            ? "No one has been marked as a participant yet."
            : participants
                .map((m) => memberLabel(m, selfUserId))
                .join(", ")}
        </p>
      )}
      {!editing && (
        <p className="mt-1 text-xs text-text-muted">
          Any member can still contribute — this just says whose goal it is.
        </p>
      )}

      {editing && (
        <div className="mt-2 flex flex-col gap-2">
          <ul className="flex flex-col gap-1.5">
            {members.map((m) => (
              <li key={m.userId}>
                <label className="flex items-center gap-2 text-sm text-text-primary">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={checked.has(m.userId)}
                    onChange={(e) =>
                      setChecked((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(m.userId);
                        else next.delete(m.userId);
                        return next;
                      })
                    }
                  />
                  {memberLabel(m, selfUserId)}
                </label>
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={isPending}
              onClick={save}
              className="min-h-9 rounded-control bg-accent px-3 text-xs font-medium text-accent-foreground disabled:opacity-50"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setErrorMessage(null);
              }}
              className="min-h-9 px-2 text-xs font-medium text-text-muted"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {errorMessage && (
        <p role="alert" className="mt-2 text-xs text-attention">
          {errorMessage}
        </p>
      )}
    </section>
  );
}
