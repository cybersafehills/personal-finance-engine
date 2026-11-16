import { groupByTitle } from "@/features/notifications/grouping";
import type { NotificationRow } from "@/features/notifications/queries";

import { COLLAPSE_THRESHOLD, groupInbox } from "../grouping";
import type { InboxItem } from "../types";

const item = (id: string, over: Partial<InboxItem> = {}): InboxItem => ({
  id,
  kind: "reconciliation_conflict",
  priority: "high",
  title: `Item ${id}`,
  description: `desc ${id}`,
  href: "/pay/reconciliation",
  actionableSince: `2026-09-0${id.length}T10:00:00Z`,
  affectedCount: 1,
  actions: [],
  ...over,
});

const many = (n: number, over: Partial<InboxItem> = {}) =>
  Array.from({ length: n }, (_, i) => item(`i${i + 1}`, { ...over, actionableSince: `2026-09-${String(i + 1).padStart(2, "0")}T10:00:00Z`, description: `desc ${i + 1}` }));

describe("groupInbox", () => {
  it("orders sections critical, high, normal and counts underlying items", () => {
    const sections = groupInbox([
      item("a", { priority: "normal", href: "/a" }),
      item("b", { priority: "critical", href: "/b" }),
      item("c", { priority: "high", href: "/c" }),
    ]);
    expect(sections.map((s) => s.title)).toEqual([
      "Resolve first (1)",
      "Next up (1)",
      "When ready (1)",
    ]);
  });

  it("omits empty priorities", () => {
    expect(groupInbox([item("a")]).map((s) => s.priority)).toEqual(["high"]);
    expect(groupInbox([])).toEqual([]);
  });

  it("collapses more than four same-kind items that share one drill-in", () => {
    const [section] = groupInbox(many(COLLAPSE_THRESHOLD + 1));
    expect(section.title).toBe("Next up (5)");
    expect(section.data).toHaveLength(1);
    expect(section.data[0]).toMatchObject({
      type: "group",
      kind: "reconciliation_conflict",
      count: 5,
      href: "/pay/reconciliation",
      oldestSince: "2026-09-01T10:00:00Z",
      latestDescription: "desc 5",
    });
  });

  it("keeps exactly four separate", () => {
    const [section] = groupInbox(many(COLLAPSE_THRESHOLD));
    expect(section.data).toHaveLength(4);
    expect(section.data.every((e) => e.type === "item")).toBe(true);
  });

  it("does not collapse when items point at different places", () => {
    const items = many(6).map((i, n) => ({ ...i, href: `/transactions/${n}` }));
    const [section] = groupInbox(items);
    expect(section.data).toHaveLength(6);
  });

  it("collapses one kind and leaves another alone, in first-seen order", () => {
    const items = [item("x", { kind: "budget_alert", href: "/budgets" }), ...many(5)];
    const [section] = groupInbox(items);
    expect(section.data.map((e) => (e.type === "item" ? e.item.kind : `group:${e.kind}`))).toEqual([
      "budget_alert",
      "group:reconciliation_conflict",
    ]);
  });
});

const note = (id: string, title: string): NotificationRow => ({
  id,
  title,
  body: null,
  resourceType: null,
  resourceId: null,
  readAt: null,
  createdAt: "2026-11-15T10:00:00Z",
});

describe("groupByTitle", () => {
  it("shows the newest per title and folds the rest", () => {
    const groups = groupByTitle([note("1", "Heads up"), note("2", "Welcome"), note("3", "Heads up")]);
    expect(groups.map((g) => g.first.id)).toEqual(["1", "2"]);
    expect(groups[0].rest.map((n) => n.id)).toEqual(["3"]);
    expect(groups[1].rest).toEqual([]);
  });
});
