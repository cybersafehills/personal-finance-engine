"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  setTransactionAttribution,
  type AttributionActionResult,
} from "../app/transactions/[id]/actions";
import { Badge } from "./Badge";
import type { SpaceMember, TransactionAttributionType } from "../lib/queries";

function memberLabel(
  members: SpaceMember[],
  userId: string | null,
  selfUserId: string | null,
): string {
  if (!userId) return "Someone";
  const m = members.find((x) => x.userId === userId);
  if (m?.displayName) return m.displayName;
  if (userId === selfUserId) return "You";
  return "A member";
}

export function TransactionAttributionPanel({
  transactionId,
  members,
  selfUserId,
  currentType,
  currentAttributedUserId,
  currentSplits,
}: {
  transactionId: string;
  members: SpaceMember[];
  selfUserId: string | null;
  currentType: TransactionAttributionType | null;
  currentAttributedUserId: string | null;
  currentSplits: Array<{ userId: string; shareBps: number }>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [type, setType] = useState<TransactionAttributionType>(
    currentType ?? "shared",
  );
  const [memberId, setMemberId] = useState(
    currentAttributedUserId ?? selfUserId ?? members[0]?.userId ?? "",
  );
  const [splitPercents, setSplitPercents] = useState<
    Array<{ userId: string; percent: number }>
  >(() =>
    currentSplits.length > 0
      ? currentSplits.map((s) => ({
          userId: s.userId,
          percent: Math.round(s.shareBps / 100),
        }))
      : members
          .slice(0, 2)
          .map((m, i) => ({ userId: m.userId, percent: i === 0 ? 50 : 50 })),
  );

  const splitTotal = useMemo(
    () => splitPercents.reduce((sum, r) => sum + (Number(r.percent) || 0), 0),
    [splitPercents],
  );
  const splitUsersUnique =
    new Set(splitPercents.map((r) => r.userId)).size === splitPercents.length;

  const run = (fn: () => Promise<AttributionActionResult>) => {
    setErrorMessage(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        setErrorMessage(result.error);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  };

  function submit() {
    if (type === "split") {
      if (splitTotal !== 100 || !splitUsersUnique) return;
      run(() =>
        setTransactionAttribution(
          transactionId,
          "split",
          null,
          splitPercents.map((r) => ({
            userId: r.userId,
            shareBps: Math.round(r.percent * 100),
          })),
        ),
      );
      return;
    }
    if (type === "member") {
      if (!memberId) return;
      run(() =>
        setTransactionAttribution(transactionId, "member", memberId, []),
      );
      return;
    }
    run(() => setTransactionAttribution(transactionId, type, null, []));
  }

  const currentSummary = (() => {
    if (currentType === "member") {
      return memberLabel(members, currentAttributedUserId, selfUserId);
    }
    if (currentType === "split") {
      return currentSplits
        .map(
          (s) =>
            `${memberLabel(members, s.userId, selfUserId)} ${Math.round(
              s.shareBps / 100,
            )}%`,
        )
        .join(" · ");
    }
    if (currentType === "shared") return "Shared by the household";
    return "Not decided yet";
  })();

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <p className="text-base font-medium text-text-primary">
          {currentSummary}
        </p>
        {currentType == null || currentType === "unassigned" ? (
          <Badge variant="attention">Needs attribution</Badge>
        ) : null}
      </div>

      {!editing && (
        <button
          type="button"
          onClick={() => {
            setErrorMessage(null);
            setEditing(true);
          }}
          className="min-h-8 self-start text-xs font-medium text-accent hover:underline"
        >
          Change
        </button>
      )}

      {editing && (
        <div className="flex flex-col gap-3 rounded-control border border-border-subtle bg-background p-3">
          <fieldset className="flex flex-col gap-2 text-sm">
            <legend className="text-xs font-medium text-text-secondary">
              Whose spending is this?
            </legend>
            {(
              [
                ["shared", "Shared — belongs to the household"],
                ["member", "One member"],
                ["split", "Split across members"],
                ["unassigned", "Not sure yet"],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="attribution-type"
                  checked={type === value}
                  onChange={() => setType(value)}
                />
                <span className="text-text-primary">{label}</span>
              </label>
            ))}
          </fieldset>

          {type === "member" && (
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium text-text-secondary">Member</span>
              <select
                value={memberId}
                onChange={(e) => setMemberId(e.target.value)}
                className="min-h-9 rounded-control border border-border-strong bg-surface px-2 py-1 text-sm text-text-primary"
              >
                {members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.displayName ??
                      (m.userId === selfUserId ? "You" : "A member")}
                  </option>
                ))}
              </select>
            </label>
          )}

          {type === "split" && (
            <div className="flex flex-col gap-2">
              {splitPercents.map((row, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <select
                    value={row.userId}
                    onChange={(e) =>
                      setSplitPercents((prev) =>
                        prev.map((r, i) =>
                          i === idx ? { ...r, userId: e.target.value } : r,
                        ),
                      )
                    }
                    className="min-h-9 flex-1 rounded-control border border-border-strong bg-surface px-2 py-1 text-sm text-text-primary"
                  >
                    {members.map((m) => (
                      <option key={m.userId} value={m.userId}>
                        {m.displayName ??
                          (m.userId === selfUserId ? "You" : "A member")}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={row.percent}
                    onChange={(e) =>
                      setSplitPercents((prev) =>
                        prev.map((r, i) =>
                          i === idx
                            ? { ...r, percent: Number(e.target.value) }
                            : r,
                        ),
                      )
                    }
                    className="min-h-9 w-16 rounded-control border border-border-strong bg-surface px-2 py-1 text-sm text-text-primary"
                    aria-label="Percent"
                  />
                  <span className="text-xs text-text-muted">%</span>
                  {splitPercents.length > 1 && (
                    <button
                      type="button"
                      onClick={() =>
                        setSplitPercents((prev) =>
                          prev.filter((_, i) => i !== idx),
                        )
                      }
                      className="min-h-8 px-1 text-xs text-text-muted hover:text-attention"
                      aria-label="Remove"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
              <div className="flex items-center justify-between text-xs">
                <button
                  type="button"
                  disabled={splitPercents.length >= members.length}
                  onClick={() =>
                    setSplitPercents((prev) => {
                      const used = new Set(prev.map((r) => r.userId));
                      const next = members.find((m) => !used.has(m.userId));
                      return next
                        ? [...prev, { userId: next.userId, percent: 0 }]
                        : prev;
                    })
                  }
                  className="font-medium text-accent hover:underline disabled:opacity-40"
                >
                  Add member
                </button>
                <span
                  className={
                    splitTotal === 100 ? "text-text-muted" : "text-attention"
                  }
                >
                  {splitTotal}% of 100%
                </span>
              </div>
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={
                isPending ||
                (type === "split" && (splitTotal !== 100 || !splitUsersUnique))
              }
              onClick={submit}
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
        <p role="alert" className="text-xs text-attention">
          {errorMessage}
        </p>
      )}
    </div>
  );
}
