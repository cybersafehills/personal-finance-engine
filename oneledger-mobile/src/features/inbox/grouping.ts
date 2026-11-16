// How the Inbox is laid out, mirroring web/components/InboxList.tsx: items
// grouped by priority ("Resolve first", "Next up", "When ready"), and past
// four same-kind items that all drill into the same place, one summary card
// instead of a wall of near-identical ones (for example dozens of payment
// reconciliation conflicts). Pure, so it is unit-tested.

import type { InboxItem, InboxPriority } from "./types";

export const COLLAPSE_THRESHOLD = 4;

const PRIORITIES: readonly InboxPriority[] = ["critical", "high", "normal"];

const PRIORITY_TITLE: Record<InboxPriority, string> = {
  critical: "Resolve first",
  high: "Next up",
  normal: "When ready",
};

export type InboxGroup = {
  type: "group";
  /** Stable key for lists. */
  id: string;
  kind: string;
  priority: InboxPriority;
  href: string;
  count: number;
  /** Oldest item's "waiting since" (the one worth calling out). */
  oldestSince: string | null;
  /** The newest item's description (what a reviewer sees first). */
  latestDescription: string;
};

export type InboxEntry = { type: "item"; item: InboxItem } | InboxGroup;

export type InboxSection = {
  priority: InboxPriority;
  /** "Resolve first (14)": the count is the number of underlying items. */
  title: string;
  data: InboxEntry[];
};

/** Same-kind runs, in the order each kind first appears. */
function partitionByKind(items: readonly InboxItem[]): InboxItem[][] {
  const order: string[] = [];
  const byKind = new Map<string, InboxItem[]>();
  for (const item of items) {
    if (!byKind.has(item.kind)) {
      byKind.set(item.kind, []);
      order.push(item.kind);
    }
    byKind.get(item.kind)!.push(item);
  }
  return order.map((kind) => byKind.get(kind)!);
}

export function groupInbox(items: readonly InboxItem[]): InboxSection[] {
  const sections: InboxSection[] = [];
  for (const priority of PRIORITIES) {
    const inPriority = items.filter((i) => i.priority === priority);
    if (inPriority.length === 0) continue;

    const data: InboxEntry[] = [];
    for (const run of partitionByKind(inPriority)) {
      const sameHref = run.every((i) => i.href === run[0].href);
      if (run.length > COLLAPSE_THRESHOLD && sameHref) {
        // The server lists oldest first within a priority.
        data.push({
          type: "group",
          id: `group:${priority}:${run[0].kind}`,
          kind: run[0].kind,
          priority,
          href: run[0].href,
          count: run.length,
          oldestSince: run[0].actionableSince,
          latestDescription: run[run.length - 1].description,
        });
      } else {
        for (const item of run) data.push({ type: "item", item });
      }
    }
    sections.push({ priority, title: `${PRIORITY_TITLE[priority]} (${inPriority.length})`, data });
  }
  return sections;
}
