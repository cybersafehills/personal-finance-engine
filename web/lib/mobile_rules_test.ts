import { assertEquals } from "jsr:@std/assert@1";
import { parseSetActive, type RuleRow, toMobileRule } from "./mobile-rules.ts";
import { ruleConditionSummary } from "./categorization/rule-summary.ts";

const row = (over: Partial<RuleRow> = {}): RuleRow => ({
  id: "r1",
  name: null,
  category: "Food",
  subcategory: null,
  match_type: "contains",
  merchant_pattern: "Simba",
  direction: "out",
  amount_min_rwf: null,
  amount_max_rwf: null,
  time_start: null,
  time_end: null,
  days_of_week: null,
  days_of_month: null,
  transaction_types: null,
  fee_min_rwf: null,
  fee_max_rwf: null,
  amount_round_multiple: null,
  priority: 10,
  is_active: true,
  rule_source: "manual",
  usage_count: 1,
  scope_type: "space",
  ...over,
});

Deno.test("summary: the web's wording for each condition", () => {
  assertEquals(ruleConditionSummary(row()), 'contains "Simba" · out');
  assertEquals(
    ruleConditionSummary(row({
      merchant_pattern: null,
      direction: null,
      amount_min_rwf: 1000,
      amount_max_rwf: null,
      time_start: "08:00:00",
      time_end: "17:30:00",
      days_of_week: [1, 5],
      days_of_month: [1, 15],
      transaction_types: ["send_money"],
      fee_min_rwf: 0,
      fee_max_rwf: 100,
      amount_round_multiple: 500,
    }), (n) => n.toString()),
    "1000–no limit RWF · 08:00–17:30 · Mon/Fri · day 1/15 · send_money · fee 0–100 RWF · ×500",
  );
  assertEquals(ruleConditionSummary(row({ merchant_pattern: null, direction: null })), "No conditions");
});

Deno.test("rule: title falls back, origin and scope are worded, numbers use en-US", () => {
  const r = toMobileRule(row({ name: "  ", merchant_pattern: "Simba", amount_min_rwf: 1234567, usage_count: 1500, rule_source: "learned", scope_type: "source", subcategory: "Groceries" }));
  assertEquals(r.title, "Simba");
  assertEquals(r.categoryLabel, "Food · Groceries");
  assertEquals(r.originLabel, "Learned from your edits");
  assertEquals(r.scopeLabel, "One account");
  assertEquals(r.matchedLabel, "Matched 1,500 times");
  assertEquals(r.summary, 'contains "Simba" · out · 1,234,567–no limit RWF');
  assertEquals(toMobileRule(row({ name: null, merchant_pattern: null })).title, "Untitled rule");
  assertEquals(toMobileRule(row({ usage_count: 1 })).matchedLabel, "Matched 1 time");
  assertEquals(toMobileRule(row({ rule_source: "mystery" })).originLabel, "mystery");
});

Deno.test("set-active body: needs two uuids and a real boolean", () => {
  const ok = { workspaceId: "00000000-0000-4000-8000-000000000001", ruleId: "00000000-0000-4000-8000-000000000002", active: false };
  assertEquals(parseSetActive(ok).ok, true);
  assertEquals(parseSetActive({ ...ok, active: "false" }).ok, false);
  assertEquals(parseSetActive({ ...ok, ruleId: "nope" }).ok, false);
  assertEquals(parseSetActive({ ...ok, workspaceId: undefined }).ok, false);
  assertEquals(parseSetActive(null).ok, false);
});
