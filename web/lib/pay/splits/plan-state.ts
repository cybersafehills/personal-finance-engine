// Payment splits - which part comes next, and what the plan panel shows.
// PURE: no I/O, no framework imports, deno-testable.

export type PlanLike = {
  kind: "capacity" | "fee_saving";
  planned_parts: readonly (string | number)[];
  total_amount_minor: number | string;
  stopped_at: string | null;
};
export type PartLike = {
  split_index: number;
  amount_minor: number | string;
  state: string;
};

/** A part counts as settled once it is `successful` (verified or manually confirmed). */
export function isPartSettled(p: { state: string }): boolean {
  return p.state === "successful";
}

/** The next part index that can be prepared, or why none can. */
export function nextPartStatus(
  plan: Pick<PlanLike, "planned_parts" | "stopped_at">,
  parts: readonly Pick<PartLike, "split_index" | "state">[],
):
  | { status: "ready"; index: number; amountMinor: string }
  | { status: "waiting"; index: number; amountMinor: string }
  /** The last part failed, expired or was reversed: the user decides (stop the plan). */
  | { status: "blocked"; index: number; amountMinor: string }
  | { status: "complete" }
  | { status: "stopped" } {
  if (plan.stopped_at) return { status: "stopped" };
  const attached = parts.filter((p) => p.state !== "cancelled");
  const nextIndex = attached.length + 1;
  if (nextIndex > plan.planned_parts.length) return { status: "complete" };
  const prev = attached[attached.length - 1];
  const amountMinor = String(plan.planned_parts[nextIndex - 1]);
  if (prev && ["failed", "expired", "reversed"].includes(prev.state)) {
    return { status: "blocked", index: nextIndex, amountMinor };
  }
  if (prev && !isPartSettled(prev)) return { status: "waiting", index: nextIndex, amountMinor };
  return { status: "ready", index: nextIndex, amountMinor };
}

export type PanelData = {
  next: ReturnType<typeof nextPartStatus>;
  /** Amount of the plan not yet prepared, as digits. "0" when nothing is left. */
  remainingMinor: string;
  /** Fee-saving only: every prepared part is settled and something is left to send. */
  canSendRemaining: boolean;
};

export function buildPanelData(plan: PlanLike, parts: readonly PartLike[]): PanelData {
  const live = parts.filter((p) => p.state !== "cancelled");
  const sent = live.reduce((sum, p) => sum + BigInt(p.amount_minor), 0n);
  const left = BigInt(plan.total_amount_minor) - sent;
  const remaining = left > 0n ? left : 0n;
  return {
    next: nextPartStatus(plan, parts),
    remainingMinor: remaining.toString(),
    canSendRemaining: plan.kind === "fee_saving" && plan.stopped_at === null &&
      live.length > 0 && live.every((p) => p.state === "successful") && remaining > 0n,
  };
}
