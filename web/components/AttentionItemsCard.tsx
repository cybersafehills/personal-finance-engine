import Link from "next/link";
import { Badge } from "./Badge";
import type { AttentionItem } from "../lib/queries";

/**
 * Concise, actionable dashboard states - counts only, never amounts, so
 * there is nothing here for full privacy mode to mask (master prompt
 * §8.3). Only ever rendered with items getAttentionItems() actually
 * found; the Home page omits this card entirely when the list is empty,
 * same as the budget status card, rather than showing a "nothing needs
 * attention" empty state that would just be noise on every quiet day.
 */
export function AttentionItemsCard({ items }: { items: AttentionItem[] }) {
  if (items.length === 0) return null;

  return (
    <section className="rounded-card border border-border-subtle bg-surface p-1.5">
      <div className="flex items-center justify-between gap-2 px-3 pb-1 pt-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
          Needs attention
        </h2>
        <Link
          href="/inbox"
          prefetch={false}
          className="text-xs font-medium text-accent hover:underline"
        >
          Open inbox
        </Link>
      </div>
      <div className="flex flex-col divide-y divide-border-subtle">
        {items.map((item) => (
          <Link
            key={item.id}
            href={item.href}
            className="flex items-center justify-between gap-3 rounded-control px-3 py-2.5 text-sm transition-colors hover:bg-background focus-visible:bg-background"
          >
            <span className="font-medium text-text-primary">{item.label}</span>
            <Badge variant="attention">{item.count}</Badge>
          </Link>
        ))}
      </div>
    </section>
  );
}
