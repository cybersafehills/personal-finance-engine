import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type {
  CategorizationPolicyRow,
  PolicyClassification,
  TransactionDirection,
} from "./types.ts";

const EMPTY_CLASSIFICATION: PolicyClassification = {
  normalizedMerchantName: null,
  category: null,
  subcategory: null,
  categorySource: null,
  categoryConfidence: null,
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

function buildExplanation(
  rule: CategorizationPolicyRow,
  counterpartyName: string | null,
): string {
  if (rule.name) {
    return `Matched your "${rule.name}" policy.`;
  }

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

  return clauses.length > 0
    ? `Matched a policy: ${clauses.join(", ")}.`
    : "Matched a policy.";
}

/**
 * Evaluates a workspace's active categorization policies against a
 * normalized transaction, first-match-wins in ascending priority order
 * (ties broken by whichever policy has more non-null conditions - the
 * more specific match). Never throws: any Supabase error is logged and
 * degrades to an empty classification, so a failure here can never block
 * ingestion of the underlying financial transaction.
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
        time_end
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
      matchesCounterparty(rule, input.counterpartyName) &&
      matchesDirection(rule, input.direction) &&
      matchesAmount(rule, input.amountRwf) &&
      matchesTimeWindow(rule, input.occurredAt)
    );

  if (candidates.length === 0) {
    return EMPTY_CLASSIFICATION;
  }

  // Priority is the primary ordering; specificity (condition count) only
  // breaks ties between policies that share the same priority - it must
  // never let a lower-priority policy win over a higher-priority one.
  candidates.sort((a, b) =>
    a.priority - b.priority || conditionCount(b) - conditionCount(a)
  );
  const rule = candidates[0];

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

  return {
    normalizedMerchantName: rule.normalized_merchant_name ??
      input.counterpartyName,
    category: rule.category ?? null,
    subcategory: rule.subcategory ?? null,
    categorySource: "rule",
    categoryConfidence: Number(rule.confidence) || 1,
    matchedPolicyId: rule.id,
    explanation: buildExplanation(rule, input.counterpartyName),
  };
}
