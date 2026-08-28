"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { movePolicyPriority, setPolicyActive } from "../app/categories/rules/actions";
import { Badge } from "./Badge";
import type { CategorizationPolicyRow } from "../lib/queries";

const DIRECTION_LABELS: Record<string, string> = {
  in: "in",
  out: "out",
  neutral: "neutral",
};

function conditionSummary(policy: CategorizationPolicyRow): string {
  const parts: string[] = [];
  if (policy.merchant_pattern) {
    parts.push(`${policy.match_type} "${policy.merchant_pattern}"`);
  }
  if (policy.direction) {
    parts.push(DIRECTION_LABELS[policy.direction] ?? policy.direction);
  }
  if (policy.amount_min_rwf !== null || policy.amount_max_rwf !== null) {
    const min = policy.amount_min_rwf !== null
      ? policy.amount_min_rwf.toLocaleString()
      : "0";
    const max = policy.amount_max_rwf !== null
      ? policy.amount_max_rwf.toLocaleString()
      : "no limit";
    parts.push(`${min}–${max} RWF`);
  }
  if (policy.time_start && policy.time_end) {
    parts.push(`${policy.time_start.slice(0, 5)}–${policy.time_end.slice(0, 5)}`);
  }
  return parts.length > 0 ? parts.join(" · ") : "No conditions";
}

export function PolicyItem(
  { policy, scopeSourceLabel = null }: {
    policy: CategorizationPolicyRow;
    /** Display label for policy.scope_source_id when scope_type === "source". */
    scopeSourceLabel?: string | null;
  },
) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function toggleActive() {
    setErrorMessage(null);
    startTransition(async () => {
      const result = await setPolicyActive(policy.id, !policy.is_active);
      if (!result.ok) {
        setErrorMessage(result.error);
        return;
      }
      router.refresh();
    });
  }

  function move(direction: "up" | "down") {
    setErrorMessage(null);
    startTransition(async () => {
      const result = await movePolicyPriority(policy.id, direction);
      if (!result.ok) {
        setErrorMessage(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2 rounded-card border border-border-subtle bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-text-primary">
            {policy.name || policy.merchant_pattern || "Untitled rule"}
          </p>
          <p className="text-sm text-text-muted">
            {policy.category}
            {policy.subcategory ? ` · ${policy.subcategory}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {!policy.is_active && <Badge variant="attention">Paused</Badge>}
          {policy.scope_type === "source" && (
            <Badge variant="neutral">
              {scopeSourceLabel ?? "One account"}
            </Badge>
          )}
          <Badge variant="neutral">{policy.rule_source}</Badge>
        </div>
      </div>

      <p className="text-xs text-text-muted">{conditionSummary(policy)}</p>

      <div className="flex items-center justify-between gap-2 text-xs text-text-muted">
        <span>
          Priority {policy.priority} · matched {policy.usage_count}{" "}
          time{policy.usage_count === 1 ? "" : "s"}
        </span>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => move("up")}
            disabled={isPending}
            aria-label="Move up (checked earlier)"
            className="font-medium text-accent disabled:opacity-50"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={() => move("down")}
            disabled={isPending}
            aria-label="Move down (checked later)"
            className="font-medium text-accent disabled:opacity-50"
          >
            ↓
          </button>
          <Link href={`/categories/rules/${policy.id}/apply`} className="font-medium text-accent">
            Apply to history
          </Link>
          <Link href={`/categories/rules/${policy.id}/edit`} className="font-medium text-accent">
            Edit
          </Link>
          <button
            type="button"
            onClick={toggleActive}
            disabled={isPending}
            className="font-medium text-accent disabled:opacity-50"
          >
            {policy.is_active ? "Pause" : "Activate"}
          </button>
        </div>
      </div>

      {errorMessage && (
        <p role="alert" className="text-xs text-attention">{errorMessage}</p>
      )}
    </div>
  );
}
