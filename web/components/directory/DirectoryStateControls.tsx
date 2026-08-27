"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  setPaymentNetworkState,
  setParticipationState,
  setAccessRouteState,
  type ActionResult,
} from "../../app/admin/directory/actions";
import { Badge } from "../Badge";
import { field, panel } from "./field-styles";

// One publication-lifecycle control shared by payment networks,
// institution participation, and access routes - the Phase P state
// machine is identical for all three (see admin_set_*_state). Deprecating
// a published record requires a reason (the RPC enforces it too).

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

const ACTIONS: Record<
  "network" | "participation" | "route",
  (id: string, state: string, reason: string) => Promise<ActionResult>
> = {
  network: setPaymentNetworkState,
  participation: setParticipationState,
  route: setAccessRouteState,
};

export function DirectoryStateControls({
  entity,
  id,
  currentState,
}: {
  entity: "network" | "participation" | "route";
  id: string;
  currentState: string;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const options = NEXT_STATES[currentState] ?? [];
  const reasonRequiredFor = new Set(["deprecated"]);

  async function transition(next: string) {
    if (reasonRequiredFor.has(next) && !reason.trim()) {
      setError("A public replacement explanation is required to deprecate.");
      return;
    }
    setPending(next);
    setError(null);
    const res = await ACTIONS[entity](id, next, reason);
    setPending(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setReason("");
    router.refresh();
  }

  return (
    <div className={panel}>
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
            <span className="mb-1 block font-medium text-text-secondary">
              Reason (required to deprecate; recorded in history)
            </span>
            <input value={reason} onChange={(e) => setReason(e.target.value)} className={field} />
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
