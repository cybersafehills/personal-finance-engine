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
});
