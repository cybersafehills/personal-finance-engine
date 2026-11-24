"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  sendRemainingAsOneAction,
  startNextSplitPartAction,
  stopSplitPlanAction,
} from "../../app/pay/splits/actions";
import { messages } from "../../lib/ussd/messages";
import { statusLabel } from "../../lib/pay/state";
import { fill, formatRwf } from "../../lib/pay/splits/format";

const t = messages().pay.splits.plan;

export type PlanPartView = {
  id: string;
  index: number;
  amountMinor: string;
  state: string;
  verifiedAt: string | null;
  manuallyConfirmedAt: string | null;
};

export type NextView =
  | { status: "ready"; index: number }
  | { status: "waiting"; index: number }
  | { status: "blocked"; index: number }
  | { status: "complete" }
  | { status: "stopped" };

/**
 * The parts of a split, shown on the payment page of any one part. Every action
 * goes through a server action that re-checks the rules: the next part exists
 * only once the previous one is settled.
 */
export function SplitPlanPanel({
  planId,
  kind,
  totalParts,
  currentIntentId,
  parts,
  next,
  remainingMinor,
  canSendRemaining,
}: {
  planId: string;
  kind: "capacity" | "fee_saving";
  totalParts: number;
  currentIntentId: string;
  parts: PlanPartView[];
  next: NextView;
  /** Amount of the plan not yet prepared, as digits. */
  remainingMinor: string;
  canSendRemaining: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<null | "next" | "stop" | "rest">(null);
  const [error, setError] = useState<string | null>(null);

  async function run(kindOfAction: "next" | "stop" | "rest") {
    if (pending) return;
    setError(null);
    setPending(kindOfAction);
    try {
      if (kindOfAction === "next") {
        const r = await startNextSplitPartAction(planId);
        if (!r.ok) return setError(r.error);
        router.push(`/pay/${r.intentId}`);
      } else if (kindOfAction === "rest") {
        const r = await sendRemainingAsOneAction(planId);
        if (!r.ok) return setError(r.error);
        router.push(`/pay/${r.intentId}`);
      } else {
        const r = await stopSplitPlanAction(planId);
        if (!r.ok) return setError(r.error);
      }
      router.refresh();
    } finally {
      setPending(null);
    }
  }

  const stoppable = next.status !== "stopped" && next.status !== "complete";

  return (
    <section
      aria-label={fill(t.title, { n: totalParts })}
      className="flex flex-col gap-3 rounded-control border border-border-subtle bg-surface px-4 py-3"
    >
      <div>
        <h2 className="text-sm font-semibold text-text-primary">
          {fill(t.title, { n: totalParts })}
        </h2>
        <p className="mt-1 text-xs text-text-secondary">
          {kind === "capacity" ? t.subtitleCapacity : t.subtitleSaving}
        </p>
      </div>

      <ol className="flex flex-col gap-1.5 text-sm">
        {parts.map((p) => {
          const isCurrent = p.id === currentIntentId;
          return (
            <li key={p.id} className="flex flex-wrap items-baseline justify-between gap-2">
              <span className={isCurrent ? "font-semibold text-text-primary" : "text-text-primary"}>
                {isCurrent
                  ? fill(t.partRow, { i: p.index, amount: formatRwf(p.amountMinor) })
                  : (
                    <Link href={`/pay/${p.id}`} className="underline">
                      {fill(t.partRow, { i: p.index, amount: formatRwf(p.amountMinor) })}
                    </Link>
                  )}
              </span>
              <span className="text-xs text-text-secondary">
                {statusLabel({
                  state: p.state,
                  verified_at: p.verifiedAt,
                  manually_confirmed_at: p.manuallyConfirmedAt,
                })}
                {isCurrent ? ` · ${t.thisPart}` : ""}
              </span>
            </li>
          );
        })}
      </ol>

      {remainingMinor !== "0" && next.status !== "stopped" && (
        <p className="text-xs text-text-secondary">
          {fill(t.remaining, { amount: formatRwf(remainingMinor) })}
        </p>
      )}

      {next.status === "waiting" && (
        <p className="text-sm text-text-secondary">{fill(t.waiting, { i: next.index - 1 })}</p>
      )}
      {next.status === "blocked" && <p className="text-sm text-attention">{t.blocked}</p>}
      {next.status === "complete" && <p className="text-sm text-text-secondary">{t.complete}</p>}
      {next.status === "stopped" && <p className="text-sm text-text-secondary">{t.stopped}</p>}

      {error && (
        <p className="text-sm text-attention" role="status">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {next.status === "ready" && (
          <button
            type="button"
            onClick={() => run("next")}
            disabled={pending !== null}
            className="min-h-11 rounded-control bg-accent px-5 py-2.5 text-sm font-semibold text-accent-foreground disabled:opacity-50"
          >
            {fill(t.prepareNext, { i: next.index })}
          </button>
        )}
        {canSendRemaining && kind === "fee_saving" && stoppable && (
          <button
            type="button"
            onClick={() => run("rest")}
            disabled={pending !== null}
            className="min-h-11 rounded-control border border-border-subtle px-4 py-2.5 text-sm font-medium text-text-primary disabled:opacity-50"
          >
            {fill(t.sendRemaining, { amount: formatRwf(remainingMinor) })}
          </button>
        )}
        {stoppable && (
          <button
            type="button"
            onClick={() => run("stop")}
            disabled={pending !== null}
            className="min-h-11 rounded-control border border-border-subtle px-4 py-2.5 text-sm font-medium text-text-secondary disabled:opacity-50"
          >
            {t.stop}
          </button>
        )}
      </div>

      <p className="text-xs text-text-muted">{t.feesNote}</p>
    </section>
  );
}
