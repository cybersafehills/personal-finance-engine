"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { resolveSuggestion } from "../../app/admin/directory/actions";
import { Badge } from "../Badge";
import { field, panel } from "./field-styles";
import type { SuggestionRow } from "../../lib/directory/suggestions";

const ACTIONS: { value: string; label: string }[] = [
  { value: "reviewing", label: "Mark reviewing" },
  { value: "needs_more_info", label: "Request more info" },
  { value: "accepted", label: "Accept" },
  { value: "declined", label: "Decline" },
  { value: "duplicate", label: "Mark duplicate" },
];

const TYPE_LABELS: Record<string, string> = {
  new_service: "New service",
  new_route: "New route",
  menu_update: "Menu update",
  fee_limit_diff: "Fee / limit difference",
  other: "Other",
};

export function SuggestionModerationPanel({
  suggestions,
  canResolve,
}: {
  suggestions: SuggestionRow[];
  canResolve: boolean;
}) {
  if (suggestions.length === 0) {
    return <p className="text-sm text-text-muted">No open suggestions.</p>;
  }
  return (
    <ul className="flex flex-col gap-3">
      {suggestions.map((s) => (
        <SuggestionCard key={s.id} s={s} canResolve={canResolve} />
      ))}
    </ul>
  );
}

function SuggestionCard({ s, canResolve }: { s: SuggestionRow; canResolve: boolean }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(status: string) {
    setBusy(status);
    setError(null);
    const res = await resolveSuggestion(s.id, status, note);
    setBusy(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setNote("");
    router.refresh();
  }

  return (
    <li className={panel}>
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <Badge variant="neutral">{TYPE_LABELS[s.suggestion_type] ?? s.suggestion_type}</Badge>
        <Badge variant={s.status === "open" ? "attention" : "neutral"}>{s.status}</Badge>
        <span className="text-xs text-text-muted">
          {new Date(s.created_at).toLocaleString()}
        </span>
      </div>
      <p className="text-sm text-text-primary">{s.body}</p>
      <p className="mt-1 text-xs text-text-muted">
        {[
          s.payment_network_slug && `network: ${s.payment_network_slug}`,
          s.institution_name && `institution: ${s.institution_name}`,
          s.channel && `channel: ${s.channel}`,
          s.device && `device: ${s.device}`,
          s.last_tested_date && `last tested: ${s.last_tested_date}`,
        ]
          .filter(Boolean)
          .join(" · ") || "no extra context"}
      </p>
      {s.resolution_note && (
        <p className="mt-1 text-xs text-text-secondary">Note: {s.resolution_note}</p>
      )}

      {canResolve && (
        <div className="mt-2 flex flex-col gap-2 border-t border-border-subtle pt-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Resolution note (recommended for accept / decline)"
            className={field}
          />
          <div className="flex flex-wrap gap-2">
            {ACTIONS.map((a) => (
              <button
                key={a.value}
                type="button"
                onClick={() => act(a.value)}
                disabled={busy !== null}
                className="min-h-11 rounded-control border border-border-subtle bg-surface px-3 py-2 text-sm font-medium text-text-primary disabled:opacity-50"
              >
                {busy === a.value ? "…" : a.label}
              </button>
            ))}
          </div>
          {error && (
            <p className="text-xs text-attention" role="status">
              {error}
            </p>
          )}
        </div>
      )}
    </li>
  );
}
