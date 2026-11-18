// The categorization-rule payloads for the mobile app
// (GET /api/mobile/categorization-rules and POST .../active). Pure: reshapes a
// stored rule into plain JSON. The condition sentence is the web's own
// (lib/categorization/rule-summary.ts), rendered here so the phone formats
// nothing; the app only displays.

import { type RuleConditions, ruleConditionSummary } from "./categorization/rule-summary.ts";

export type RuleRow = RuleConditions & {
  id: string;
  name: string | null;
  category: string;
  subcategory: string | null;
  priority: number;
  is_active: boolean;
  rule_source: string;
  usage_count: number;
  scope_type: string;
};

export type MobileRule = {
  id: string;
  title: string;
  categoryLabel: string;
  summary: string;
  active: boolean;
  /** "Created by you", "Learned from your edits" or "Built in". */
  originLabel: string;
  /** "One account" when the rule only applies to a single source. */
  scopeLabel: string | null;
  matchedLabel: string;
};

const ORIGIN: Record<string, string> = {
  manual: "Created by you",
  learned: "Learned from your edits",
  system: "Built in",
};

const en = (n: number) => n.toLocaleString("en-US");

export function toMobileRule(row: RuleRow): MobileRule {
  return {
    id: row.id,
    title: row.name?.trim() || row.merchant_pattern?.trim() || "Untitled rule",
    categoryLabel: row.subcategory ? `${row.category} · ${row.subcategory}` : row.category,
    summary: ruleConditionSummary(row, en),
    active: row.is_active,
    originLabel: ORIGIN[row.rule_source] ?? row.rule_source,
    scopeLabel: row.scope_type === "source" ? "One account" : null,
    matchedLabel: `Matched ${en(row.usage_count)} time${row.usage_count === 1 ? "" : "s"}`,
  };
}

export type SetActiveRequest = { workspaceId: string; ruleId: string; active: boolean };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseSetActive(
  body: unknown,
): { ok: true; value: SetActiveRequest } | { ok: false; message: string } {
  const fail = { ok: false as const, message: "That request wasn't understood." };
  if (typeof body !== "object" || body === null) return fail;
  const b = body as Record<string, unknown>;
  if (typeof b.workspaceId !== "string" || !UUID.test(b.workspaceId)) return fail;
  if (typeof b.ruleId !== "string" || !UUID.test(b.ruleId)) return fail;
  if (typeof b.active !== "boolean") return fail;
  return { ok: true, value: { workspaceId: b.workspaceId, ruleId: b.ruleId, active: b.active } };
}
