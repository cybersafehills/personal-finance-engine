"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { adminSetState } from "../../app/admin/ussd/actions";
import { Badge } from "../Badge";

const NEXT_STATES: Record<string, string[]> = {
  draft: ["pending_review", "archived"],
  pending_review: ["published", "draft", "archived"],
  published: ["temporarily_unavailable", "deprecated", "archived"],
  temporarily_unavailable: ["published", "deprecated", "archived"],
  deprecated: ["published", "archived"],
  archived: [],
};

const STATE_LABELS: Record<string, string> = {
  draft: "Draft",
  pending_review: "Pending review",
  published: "Published",
  temporarily_unavailable: "Temporarily unavailable",
  deprecated: "Deprecated",
  archived: "Archived",
};

export function AdminStateControls({
  serviceCodeId,
  currentState,
}: {
  serviceCodeId: string;
  currentState: string;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function transition(next: string) {
    setPending(next);
    setError(null);
    const res = await adminSetState(serviceCodeId, next, reason);
    setPending(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setReason("");
    router.refresh();
  }

  const options = NEXT_STATES[currentState] ?? [];

  return (
    <div className="rounded-control border border-border-subtle p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-sm font-semibold text-text-primary">State</span>
        <Badge variant={currentState === "published" ? "positive" : "neutral"}>
          {STATE_LABELS[currentState] ?? currentState}
        </Badge>
      </div>
      {options.length === 0 ? (
        <p className="text-xs text-text-muted">No further transitions from here.</p>
      ) : (
        <>
          <label className="mb-2 block text-sm">
            <span className="mb-1 block font-medium text-text-secondary">Reason (optional)</span>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full rounded-control border border-border-subtle bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            {options.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => transition(s)}
                disabled={pending !== null}
                className="min-h-11 rounded-control border border-border-subtle bg-surface px-3 py-2 text-sm font-medium text-text-primary disabled:opacity-50"
              >
                {pending === s ? "…" : `→ ${STATE_LABELS[s] ?? s}`}
              </button>
            ))}
          </div>
        </>
      )}
      {error && (
        <p className="mt-2 text-xs text-attention" role="status">
          {error}
        </p>
      )}
    </div>
  );
}
