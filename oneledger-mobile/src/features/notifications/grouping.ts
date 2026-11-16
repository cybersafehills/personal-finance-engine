import type { NotificationRow } from "./queries";

// A recurring alert (the daily cash-flow "heads up") re-fires with slightly
// different numbers, which reads as noise when several land back to back. Same
// title -> show the newest in full and fold the rest behind "Show N earlier"
// (web/components/NotificationList.tsx).

export type NotificationGroup = { first: NotificationRow; rest: NotificationRow[] };

export function groupByTitle(list: readonly NotificationRow[]): NotificationGroup[] {
  const order: string[] = [];
  const byTitle = new Map<string, NotificationRow[]>();
  for (const n of list) {
    if (!byTitle.has(n.title)) {
      byTitle.set(n.title, []);
      order.push(n.title);
    }
    byTitle.get(n.title)!.push(n);
  }
  return order.map((title) => {
    const [first, ...rest] = byTitle.get(title)!;
    return { first, rest };
  });
}
