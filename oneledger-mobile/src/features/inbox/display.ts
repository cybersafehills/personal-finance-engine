import type { InboxResult } from "./parse";
import type { InboxInlineAction, InboxItem } from "./types";

const KIND_LABELS: Record<string, string> = {
  connector_health: "Connection",
  reconciliation_conflict: "Payment",
  duplicate_candidate: "Duplicate",
  needs_attribution: "Attribution",
  category_review: "Category",
  import_review: "Import",
  sync_conflict: "Sync",
  rule_suggestion: "Rule",
  budget_alert: "Budget",
  bill_review: "Bill",
};

export function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? "Needs attention";
}

const TRANSACTION_HREF = /^\/transactions\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** The transaction an item points at, when its drill-in is a single transaction. */
export function transactionIdFromHref(href: string): string | null {
  return TRANSACTION_HREF.exec(href)?.[1] ?? null;
}

/** Absolute web URL for an item's drill-in, or null when the base is unknown. */
export function webUrl(baseUrl: string, href: string): string | null {
  if (!baseUrl || !href.startsWith("/") || href.startsWith("//")) return null;
  return `${baseUrl}${href}`;
}

/** Items the user can re-categorise from the app. */
export function canPickCategory(item: InboxItem): boolean {
  return item.kind === "category_review" && transactionIdFromHref(item.href) !== null;
}

/** Stable key so a decided action removes exactly its item. */
export function actionKey(action: InboxInlineAction): string {
  return action.type === "merge_duplicate"
    ? `${action.type}:${action.duplicateId}`
    : `${action.type}:${action.transactionId}`;
}

/**
 * When the full Inbox can't be shown, the tab falls back to the direct
 * category-review queue so a category check is never out of reach. Returns
 * the line to show above that list, or null when the full Inbox (or a
 * sign-in / two-step problem, which needs its own message) applies.
 * A server error falls back too: the app can still read the queue itself.
 */
export function fallbackNotice(result: InboxResult | null): string | null {
  if (!result || result.ok) return null;
  if (result.reason === "unavailable") {
    return "Category checks (the full inbox isn't available yet)";
  }
  if (result.reason === "error") {
    return "Category checks only (the full inbox couldn't load)";
  }
  return null;
}
