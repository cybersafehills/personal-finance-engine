import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type {
  CategorizationPolicyRow,
  DecisionStatus,
  PolicyClassification,
  TransactionDirection,
} from "./types.ts";

// Confidence tiers (spec default table): 90-100 auto-categorize, 70-89
// provisionally categorize (committed, but flagged for review), 50-69
// suggest without committing, below 50 leave Uncategorized. Confidence is
// a static per-policy value (set once at policy creation), so every
// transaction a given policy matches lands in the same tier - there is no
// per-transaction evidence reweighting in this increment.
const AUTO_THRESHOLD = 0.90;
const PROVISIONAL_THRESHOLD = 0.70;
const SUGGEST_THRESHOLD = 0.50;

function tierForConfidence(confidence: number): DecisionStatus {
  if (confidence >= AUTO_THRESHOLD) return "auto";
  if (confidence >= PROVISIONAL_THRESHOLD) return "provisional";
  if (confidence >= SUGGEST_THRESHOLD) return "suggested";
  return "uncategorized";
}

const EMPTY_CLASSIFICATION: PolicyClassification = {
  normalizedMerchantName: null,
  category: null,
  subcategory: null,
  categorySource: null,
  categoryConfidence: null,
  suggestedCategory: null,
  suggestedSubcategory: null,
  decisionStatus: "uncategorized",
  matchedPolicyId: null,
  explanation: null,
};

export type EvaluatePoliciesInput = {
  workspaceId: string;
  direction: TransactionDirection;
  amountRwf: number;
  counterpartyName: string | null;
  /** ISO 8601 timestamp with a local offset, as produced by the parser (e.g. Kigali's +02:00). */
  occurredAt: string;
  /** The transaction's routed financial source, for evaluating 'source'-scoped policies. Null when the routed account has no linked source. */
  financialSourceId: string | null;
};

function matchesCounterparty(
  rule: CategorizationPolicyRow,
  counterpartyName: string | null,
): boolean {
  if (!rule.merchant_pattern) {
    return true;
  }

  if (!counterpartyName) {
    return false;
  }

  const normalizedCounterparty = counterpartyName.trim().toLowerCase();
  const pattern = String(rule.merchant_pattern).trim().toLowerCase();

  switch (rule.match_type) {
    case "exact":
      return normalizedCounterparty === pattern;
    case "contains":
      return normalizedCounterparty.includes(pattern);
    case "starts_with":
      return normalizedCounterparty.startsWith(pattern);
    case "regex":
      try {
        return new RegExp(rule.merchant_pattern, "i").test(counterpartyName);
      } catch {
        return false;
      }
    default:
      return false;
  }
}

function matchesDirection(
  rule: CategorizationPolicyRow,
  direction: TransactionDirection,
): boolean {
  return rule.direction === null || rule.direction === direction;
}

/**
 * A 'source'-scoped policy applies only to transactions from its
 * scope_source_id. A 'space'-scoped policy (the default) always passes
 * this gate. Mirrors the scope clause in policy_matches_transaction()
 * (migration 20260830000000, re-issued in 20260924000000).
 */
function matchesScope(
  rule: CategorizationPolicyRow,
  financialSourceId: string | null,
): boolean {
  if (rule.scope_type !== "source") {
    return true;
  }
  return rule.scope_source_id != null &&
    rule.scope_source_id === financialSourceId;
}

/** 1 for a source-scoped policy, 0 for space - a within-tier ranking bump, never a priority override. */
function scopeRank(rule: CategorizationPolicyRow): number {
  return rule.scope_type === "source" ? 1 : 0;
}

function matchesAmount(
  rule: CategorizationPolicyRow,
  amountRwf: number,
): boolean {
  if (rule.amount_min_rwf !== null && amountRwf < rule.amount_min_rwf) {
    return false;
  }
  if (rule.amount_max_rwf !== null && amountRwf > rule.amount_max_rwf) {
    return false;
  }
  return true;
}

/** Extracts "HH:MM:SS" from an ISO timestamp that carries its own local offset, without a separate timezone lookup. */
function localTimeOfDay(occurredAt: string): string | null {
  const match = occurredAt.match(/T(\d{2}:\d{2}:\d{2})/);
  return match ? match[1] : null;
}

function matchesTimeWindow(
  rule: CategorizationPolicyRow,
  occurredAt: string,
): boolean {
  if (rule.time_start === null || rule.time_end === null) {
    return true;
  }

  const timeOfDay = localTimeOfDay(occurredAt);
  if (!timeOfDay) {
    // No reliable timestamp to evaluate a time condition against - fail
    // closed (do not match) rather than fabricate a match.
    return false;
  }

  const start = rule.time_start;
  const end = rule.time_end;

  if (start <= end) {
    return timeOfDay >= start && timeOfDay <= end;
  }

  // Window crosses midnight (e.g. 22:00-02:00).
  return timeOfDay >= start || timeOfDay <= end;
}

function conditionCount(rule: CategorizationPolicyRow): number {
  let count = 0;
  if (rule.merchant_pattern) count += 1;
  if (rule.direction !== null) count += 1;
  if (rule.amount_min_rwf !== null) count += 1;
  if (rule.amount_max_rwf !== null) count += 1;
  if (rule.time_start !== null) count += 1;
  return count;
}

function describeConditions(
  rule: CategorizationPolicyRow,
  counterpartyName: string | null,
): string {
  const clauses: string[] = [];
  if (rule.merchant_pattern && counterpartyName) {
    clauses.push(`counterparty ${rule.match_type} "${rule.merchant_pattern}"`);
  }
  if (rule.direction) {
    clauses.push(`direction is ${rule.direction}`);
  }
  if (rule.amount_min_rwf !== null || rule.amount_max_rwf !== null) {
    const min = rule.amount_min_rwf ?? 0;
    const max = rule.amount_max_rwf;
    clauses.push(
      max !== null
        ? `amount between ${min} and ${max} RWF`
        : `amount at least ${min} RWF`,
    );
  }
  if (rule.time_start && rule.time_end) {
    clauses.push(`time between ${rule.time_start} and ${rule.time_end}`);
  }
  return clauses.join(", ");
}

function buildExplanation(
  rule: CategorizationPolicyRow,
  counterpartyName: string | null,
): string {
  const scopeSuffix = rule.scope_type === "source" ? " for this account" : "";

  if (rule.name) {
    return `Matched your "${rule.name}" policy${scopeSuffix}.`;
  }

  const clauses = describeConditions(rule, counterpartyName);
  return clauses.length > 0
    ? `Matched a policy${scopeSuffix}: ${clauses}.`
    : `Matched a policy${scopeSuffix}.`;
}

function buildConflictExplanation(
  candidates: CategorizationPolicyRow[],
  counterpartyName: string | null,
): string {
  const descriptions = candidates.map((c) => {
    const label = c.name
      ? `"${c.name}"`
      : `(${describeConditions(c, counterpartyName) || "no conditions"})`;
    const outcome = c.subcategory
      ? `${c.category} → ${c.subcategory}`
      : c.category;
    return `${label} → ${outcome}`;
  });
  return `Conflicting policies matched equally well with different outcomes: ${
    descriptions.join(" vs. ")
  }. Needs review.`;
}

/**
 * Evaluates a workspace's active categorization policies against a
 * normalized transaction, first-match-wins in ascending priority order
 * (within a tier, a source-scoped policy outranks a space-scoped one,
 * then whichever policy has more non-null conditions - the more specific
 * match), then tiers the result by the winning policy's confidence. A
 * source-scoped policy whose scope_source_id does not match the
 * transaction's financial source is filtered out before any of this. If
 * more than one policy is tied for the very best (priority, scope,
 * specificity) and they disagree on the resulting category,
 * nothing is committed - the transaction is flagged 'conflict' for
 * review instead of silently picking one arbitrarily. Never throws: any
 * Supabase error is logged and degrades to an empty classification, so a
 * failure here can never block ingestion of the underlying financial
 * transaction.
 *
 * This same per-condition matching logic (scope/counterparty/direction/
 * amount/time) is duplicated, deliberately and narrowly, in
 * policy_matches_transaction() (SQL) - defined in
 * supabase/migrations/20260830000000_phase_g_review_and_backfill.sql and
 * re-issued with the scope clause in
 * supabase/migrations/20260924000000_phase_u_rule_scope.sql - used for
 * historical preview/backfill against a single policy at a time (no
 * priority/conflict resolution needed there). Keep the two in sync by
 * hand if either changes.
 */
export async function evaluatePolicies(
  supabase: SupabaseClient,
  input: EvaluatePoliciesInput,
): Promise<PolicyClassification> {
  const { data: rules, error } = await supabase
    .from("categorization_policies")
    .select(
      `
        id,
        name,
        priority,
        match_type,
        merchant_pattern,
        normalized_merchant_name,
        category,
        subcategory,
        confidence,
        usage_count,
        direction,
        amount_min_rwf,
        amount_max_rwf,
        time_start,
        time_end,
        scope_type,
        scope_source_id
      `,
    )
    .eq("workspace_id", input.workspaceId)
    .eq("is_active", true)
    .order("priority", { ascending: true });

  if (error || !rules) {
    console.error("Categorization policy lookup failed:", error);
    return EMPTY_CLASSIFICATION;
  }

  const candidates = (rules as CategorizationPolicyRow[])
    .filter((rule) =>
      matchesScope(rule, input.financialSourceId) &&
      matchesCounterparty(rule, input.counterpartyName) &&
      matchesDirection(rule, input.direction) &&
      matchesAmount(rule, input.amountRwf) &&
      matchesTimeWindow(rule, input.occurredAt)
    );

  if (candidates.length === 0) {
    return EMPTY_CLASSIFICATION;
  }

  // Priority is the primary ordering. Within one priority tier, a
  // source-scoped policy outranks a space-scoped one; specificity
  // (condition count) is the last tie-break. Neither of the two
  // tie-breaks can ever let a lower-priority policy win over a
  // higher-priority one.
  candidates.sort((a, b) =>
    a.priority - b.priority ||
    scopeRank(b) - scopeRank(a) ||
    conditionCount(b) - conditionCount(a)
  );

  const best = candidates[0];
  const tiedForBest = candidates.filter((c) =>
    c.priority === best.priority &&
    scopeRank(c) === scopeRank(best) &&
    conditionCount(c) === conditionCount(best)
  );
  const distinctOutcomes = new Set(
    tiedForBest.map((c) => `${c.category ?? ""}|${c.subcategory ?? ""}`),
  );

  if (distinctOutcomes.size > 1) {
    return {
      ...EMPTY_CLASSIFICATION,
      decisionStatus: "conflict",
      explanation: buildConflictExplanation(
        tiedForBest,
        input.counterpartyName,
      ),
    };
  }

  const rule = best;

  const currentUsageCount = Number(rule.usage_count ?? 0);
  const { error: usageUpdateError } = await supabase
    .from("categorization_policies")
    .update({
      usage_count: currentUsageCount + 1,
      last_used_at: new Date().toISOString(),
    })
    .eq("id", rule.id);

  if (usageUpdateError) {
    console.error(
      "Categorization policy usage update failed:",
      usageUpdateError,
    );
  }

  const confidence = Number(rule.confidence) || 1;
  const tier = tierForConfidence(confidence);
  const explanation = buildExplanation(rule, input.counterpartyName);
  const normalizedMerchantName = rule.normalized_merchant_name ??
    input.counterpartyName;

  if (tier === "uncategorized") {
    // Below the suggest threshold: leave Uncategorized entirely, per
    // spec - not even a suggestion is surfaced for a match this weak.
    return { ...EMPTY_CLASSIFICATION, normalizedMerchantName };
  }

  if (tier === "suggested") {
    return {
      ...EMPTY_CLASSIFICATION,
      normalizedMerchantName,
      categoryConfidence: confidence,
      suggestedCategory: rule.category ?? null,
      suggestedSubcategory: rule.subcategory ?? null,
      decisionStatus: "suggested",
      matchedPolicyId: rule.id,
      explanation,
    };
  }

  // auto or provisional: commit the category.
  return {
    normalizedMerchantName,
    category: rule.category ?? null,
    subcategory: rule.subcategory ?? null,
    categorySource: "rule",
    categoryConfidence: confidence,
    suggestedCategory: null,
    suggestedSubcategory: null,
    decisionStatus: tier,
    matchedPolicyId: rule.id,
    explanation,
  };
}
