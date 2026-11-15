// Mirrors web/lib/financial-inbox-model.ts (the /api/mobile/inbox payload).
// Only the fields the app reads. The server is the source of truth for
// ordering and for which kinds exist, so unknown kinds are shown generically.

export type InboxPriority = "critical" | "high" | "normal";

export type InboxInlineAction =
  | { type: "confirm_category"; label: string; transactionId: string }
  | { type: "dismiss_category"; label: string; transactionId: string }
  | { type: "dismiss_duplicate"; label: string; transactionId: string }
  | { type: "merge_duplicate"; label: string; duplicateId: string; canonicalId: string };

export type InboxItem = {
  id: string;
  kind: string;
  priority: InboxPriority;
  title: string;
  description: string;
  /** A path on the web app, e.g. "/transactions/<id>". */
  href: string;
  actionableSince: string | null;
  affectedCount: number;
  /** Only the actions the app can perform itself; the rest drill in. */
  actions: InboxInlineAction[];
};

export type Inbox = {
  items: InboxItem[];
  total: number;
  criticalCount: number;
  highCount: number;
};
