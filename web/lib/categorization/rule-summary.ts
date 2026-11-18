// Pure wording for a categorization rule's conditions, shared by the web's
// PolicyItem and the mobile API (lib/mobile-rules.ts) so the two never describe
// the same rule differently. No framework or server-only imports: Deno-testable.

export type RuleConditions = {
  match_type: string;
  merchant_pattern: string | null;
  direction: string | null;
  amount_min_rwf: number | null;
  amount_max_rwf: number | null;
  time_start: string | null;
  time_end: string | null;
  days_of_week: number[] | null;
  days_of_month: number[] | null;
  transaction_types: string[] | null;
  fee_min_rwf: number | null;
  fee_max_rwf: number | null;
  amount_round_multiple: number | null;
};

const WEEKDAY_LABELS = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * `fmt` formats a number. The web leaves it at the viewer's locale; the mobile
 * API passes a fixed one so the phone never formats anything itself.
 */
export function ruleConditionSummary(
  policy: RuleConditions,
  fmt: (n: number) => string = (n) => n.toLocaleString(),
): string {
  const parts: string[] = [];
  if (policy.merchant_pattern) {
    parts.push(`${policy.match_type} "${policy.merchant_pattern}"`);
  }
  if (policy.direction) parts.push(policy.direction);
  if (policy.amount_min_rwf !== null || policy.amount_max_rwf !== null) {
    const min = policy.amount_min_rwf !== null ? fmt(policy.amount_min_rwf) : "0";
    const max = policy.amount_max_rwf !== null ? fmt(policy.amount_max_rwf) : "no limit";
    parts.push(`${min}–${max} RWF`);
  }
  if (policy.time_start && policy.time_end) {
    parts.push(`${policy.time_start.slice(0, 5)}–${policy.time_end.slice(0, 5)}`);
  }
  if (policy.days_of_week && policy.days_of_week.length > 0) {
    parts.push(policy.days_of_week.map((d) => WEEKDAY_LABELS[d] ?? d).join("/"));
  }
  if (policy.days_of_month && policy.days_of_month.length > 0) {
    parts.push(`day ${policy.days_of_month.join("/")}`);
  }
  if (policy.transaction_types && policy.transaction_types.length > 0) {
    parts.push(policy.transaction_types.join("/"));
  }
  if (policy.fee_min_rwf !== null || policy.fee_max_rwf !== null) {
    const min = policy.fee_min_rwf !== null ? fmt(policy.fee_min_rwf) : "0";
    const max = policy.fee_max_rwf !== null ? fmt(policy.fee_max_rwf) : "no limit";
    parts.push(`fee ${min}–${max} RWF`);
  }
  if (policy.amount_round_multiple !== null) parts.push(`×${policy.amount_round_multiple}`);
  return parts.length > 0 ? parts.join(" · ") : "No conditions";
}
