import type { Inbox, InboxInlineAction, InboxItem, InboxPriority } from "./types";

const PRIORITIES: readonly InboxPriority[] = ["critical", "high", "normal"];

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;
const str = (v: unknown): v is string => typeof v === "string" && v.length > 0;

/**
 * Only actions the app can run itself are kept (they are plain database
 * calls). Anything else - assign, accept rule, reconcile - is dropped here
 * and the item simply drills into the web. Malformed actions are dropped too.
 */
function parseAction(raw: unknown): InboxInlineAction | null {
  if (!isRecord(raw) || !str(raw.label)) return null;
  switch (raw.type) {
    case "confirm_category":
    case "dismiss_category":
    case "dismiss_duplicate":
      return str(raw.transactionId)
        ? { type: raw.type, label: raw.label, transactionId: raw.transactionId }
        : null;
    case "merge_duplicate":
      return str(raw.duplicateId) && str(raw.canonicalId)
        ? {
            type: "merge_duplicate",
            label: raw.label,
            duplicateId: raw.duplicateId,
            canonicalId: raw.canonicalId,
          }
        : null;
    default:
      return null;
  }
}

function parseItem(raw: unknown): InboxItem | null {
  if (!isRecord(raw)) return null;
  const { id, kind, priority, title, description, href } = raw;
  if (!str(id) || !str(kind) || !str(title) || !str(href)) return null;
  if (!PRIORITIES.includes(priority as InboxPriority)) return null;
  return {
    id,
    kind,
    priority: priority as InboxPriority,
    title,
    description: typeof description === "string" ? description : "",
    href,
    actionableSince: str(raw.actionableSince) ? raw.actionableSince : null,
    affectedCount:
      typeof raw.affectedCount === "number" && raw.affectedCount > 0 ? raw.affectedCount : 1,
    actions: (Array.isArray(raw.actions) ? raw.actions : [])
      .map(parseAction)
      .filter((a): a is InboxInlineAction => a !== null),
  };
}

/** Validates the payload; a malformed item is skipped, never fatal. */
export function parseInbox(raw: unknown): Inbox | null {
  if (!isRecord(raw) || !Array.isArray(raw.items)) return null;
  const items = raw.items.map(parseItem).filter((i): i is InboxItem => i !== null);
  return {
    items,
    total: items.length,
    criticalCount: items.filter((i) => i.priority === "critical").length,
    highCount: items.filter((i) => i.priority === "high").length,
  };
}

export type InboxResult =
  | { ok: true; inbox: Inbox }
  | {
      ok: false;
      /** `unavailable`: the endpoint is off or the app isn't configured -
       *  fall back to the direct review queue. */
      reason: "unavailable" | "unauthorized" | "mfa_required" | "error";
      message: string;
    };

/** Maps the endpoint's HTTP status and JSON to a typed result. */
export function parseInboxResponse(status: number, body: unknown): InboxResult {
  if (status === 200 && isRecord(body) && body.ok === true) {
    const inbox = parseInbox(isRecord(body.inbox) ? body.inbox : null);
    if (inbox) return { ok: true, inbox };
    return { ok: false, reason: "error", message: "The inbox response wasn't understood." };
  }
  if (status === 404) {
    return { ok: false, reason: "unavailable", message: "The full inbox isn't available yet." };
  }
  if (status === 401) {
    return { ok: false, reason: "unauthorized", message: "Please sign in again." };
  }
  if (status === 403) {
    return {
      ok: false,
      reason: "mfa_required",
      message: "Finish two-step verification to see your inbox.",
    };
  }
  return {
    ok: false,
    reason: "error",
    message: "Couldn't load your inbox. Check your connection and try again.",
  };
}
