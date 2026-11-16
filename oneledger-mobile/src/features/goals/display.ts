import type { Goal, GoalType } from "./types";

const TYPE_LABELS: Record<GoalType, string> = {
  emergency_fund: "Emergency fund",
  investing: "Investing",
  planned_purchase: "Planned purchase",
  debt: "Debt repayment",
  general_savings: "General savings",
};

export const goalTypeLabel = (type: GoalType): string => TYPE_LABELS[type];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "12 Mar 2027" from a YYYY-MM-DD key (no time zone conversion). */
export function dayLabel(dateKey: string): string {
  const [y, m, d] = dateKey.split("-");
  return `${Number(d)} ${MONTHS[Number(m) - 1] ?? ""} ${y}`.replace("  ", " ").trim();
}

/** 0-100 share of the target reached. The database's figure when we have it. */
export function percentComplete(goal: Pick<Goal, "currentMinor" | "targetMinor" | "progress">): number {
  const raw =
    goal.progress?.pctComplete ??
    (goal.targetMinor > 0 ? (goal.currentMinor / goal.targetMinor) * 100 : 0);
  return Math.min(100, Math.max(0, raw));
}

export const isReached = (goal: Pick<Goal, "currentMinor" | "targetMinor">): boolean =>
  goal.targetMinor > 0 && goal.currentMinor >= goal.targetMinor;

/**
 * Plain sentences about pace, from the database's own projection. Only for
 * active goals that are not yet reached; `fmt` formats a minor-unit amount.
 */
export function paceNotes(goal: Goal, fmt: (minor: number) => string): string[] {
  if (goal.status !== "active" || isReached(goal) || !goal.progress) return [];
  const p = goal.progress;
  const notes: string[] = [];

  if (goal.targetDate) {
    if (p.monthsToTarget !== null && p.monthsToTarget <= 0) {
      notes.push(`The target date (${dayLabel(goal.targetDate)}) has passed.`);
    } else if (p.requiredMonthlyMinor > 0) {
      notes.push(`Save about ${fmt(p.requiredMonthlyMinor)} a month to reach it by ${dayLabel(goal.targetDate)}.`);
    }
  }
  if (p.projectedCompletionDate) {
    notes.push(`At your recent pace you'd reach it around ${dayLabel(p.projectedCompletionDate)}.`);
  } else {
    notes.push("No contributions in the last 3 months, so there's no projection yet.");
  }
  return notes;
}

const STATUS_RANK = { active: 0, completed: 1, archived: 2 } as const;

/** Active first, then completed, then archived; otherwise the given order. */
export function sortGoals(goals: readonly Goal[]): Goal[] {
  return goals
    .map((g, i) => ({ g, i }))
    .sort((a, b) => STATUS_RANK[a.g.status] - STATUS_RANK[b.g.status] || a.i - b.i)
    .map(({ g }) => g);
}
