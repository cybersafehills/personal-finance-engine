import { assertEquals } from "jsr:@std/assert@1";
import {
  buildFinancialInbox,
  type FinancialInboxItem,
} from "./financial-inbox-model.ts";

function item(
  id: string,
  priority: FinancialInboxItem["priority"],
  actionableSince: string | null,
  kind: FinancialInboxItem["kind"] = "category_review",
): FinancialInboxItem {
  return { id, priority, actionableSince, kind, title: id, description: id, href: "/", affectedCount: 1 };
}

Deno.test("orders by priority, then oldest action, then stable keys", () => {
  const inbox = buildFinancialInbox([
    item("normal", "normal", "2026-01-01T00:00:00Z"),
    item("new-critical", "critical", "2026-03-01T00:00:00Z"),
    item("old-critical", "critical", "2026-02-01T00:00:00Z"),
    item("undated-high", "high", null),
    item("dated-high", "high", "2026-04-01T00:00:00Z"),
  ]);

  assertEquals(inbox.items.map(({ id }) => id), [
    "old-critical",
    "new-critical",
    "dated-high",
    "undated-high",
    "normal",
  ]);
});

Deno.test("summarizes workflow items by severity and kind", () => {
  const inbox = buildFinancialInbox([
    item("connector", "critical", null, "connector_health"),
    item("duplicate", "high", null, "duplicate_candidate"),
    item("category", "normal", null, "category_review"),
  ]);

  assertEquals(inbox.total, 3);
  assertEquals(inbox.criticalCount, 1);
  assertEquals(inbox.highCount, 1);
  assertEquals(inbox.countsByKind.connector_health, 1);
  assertEquals(inbox.countsByKind.duplicate_candidate, 1);
  assertEquals(inbox.countsByKind.budget_alert, 0);
  // The kind added for bill review is part of the summary shape.
  assertEquals(inbox.countsByKind.bill_review, 0);
});

Deno.test("financial impact is a tie-break only, after severity and age", () => {
  const base = (
    id: string,
    since: string | null,
    impact: number | undefined,
  ): FinancialInboxItem => ({
    ...item(id, "high", since),
    financialImpactMinor: impact,
  });
  const inbox = buildFinancialInbox([
    base("small-older", "2026-01-01T00:00:00Z", 1_000),
    base("big-newer", "2026-02-01T00:00:00Z", 9_999_999),
    base("big-sameday", "2026-01-01T00:00:00Z", 500_000),
    base("nil-sameday", "2026-01-01T00:00:00Z", undefined),
  ]);
  // Age wins first: both 2026-01-01 items come before the 2026-02-01 one.
  // Among the same-day items, larger impact first, then the nil-impact one.
  assertEquals(inbox.items.map((i) => i.id), [
    "big-sameday",
    "small-older",
    "nil-sameday",
    "big-newer",
  ]);
});

Deno.test("carries an item's inline actions through unchanged", () => {
  const withAction: FinancialInboxItem = {
    ...item("cat-1", "normal", null, "category_review"),
    actions: [
      { type: "confirm_category", label: "Confirm Groceries", transactionId: "t1" },
      { type: "dismiss_category", label: "Not now", transactionId: "t1" },
    ],
  };
  const inbox = buildFinancialInbox([withAction]);
  assertEquals(inbox.items[0].actions?.length, 2);
  assertEquals(inbox.items[0].actions?.[0].type, "confirm_category");
});
