export type GoalType = "emergency_fund" | "investing" | "planned_purchase" | "debt" | "general_savings";
export type GoalStatus = "active" | "completed" | "archived";
export type Currency = "RWF" | "EUR" | "USD";

/** What `goal_progress()` computes in the database; the app never recomputes it. */
export type GoalProgress = {
  pctComplete: number;
  /** Days-based; null when the goal has no target date. */
  monthsToTarget: number | null;
  requiredMonthlyMinor: number;
  recentMonthlyRateMinor: number;
  projectedCompletionDate: string | null;
};

export type Goal = {
  id: string;
  type: GoalType;
  name: string;
  description: string | null;
  currency: Currency;
  targetMinor: number;
  currentMinor: number;
  targetDate: string | null;
  status: GoalStatus;
  /** null for non-active goals, or when the progress call failed. */
  progress: GoalProgress | null;
};
