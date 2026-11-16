// Pure display rules for the transaction detail screen. Mirrors the web page
// (web/app/transactions/[id]/page.tsx) so the two say the same thing.

export type AllocationStatus = "allocated" | "needs_space" | "needs_attribution";
export type WorkspaceKind = "personal" | "household" | "organization";

export type TransactionContext = {
  workspaceId: string;
  workspaceName: string | null;
  workspaceKind: WorkspaceKind;
  sourceName: string | null;
  sourceProvider: string | null;
  sourceMaskedIdentifier: string | null;
  sourceOwnerUserId: string | null;
  performedByUserId: string | null;
  recordCreatedByUserId: string | null;
  ingestionConnectionLabel: string | null;
  allocationStatus: AllocationStatus;
  categorySource: string | null;
};

export type CategoryHistoryEntry = {
  id: string;
  previous_category: string | null;
  new_category: string | null;
  decision_reason: string | null;
  actor_type: string;
  created_at: string;
};

export type Member = { userId: string; displayName: string | null };

const PROVIDER_LABELS: Record<string, string> = {
  mtn_momo: "MTN MoMo",
  airtel_money: "Airtel Money",
  bank: "Bank",
  card: "Card",
  cash: "Cash",
  statement: "Imported statement",
  other: "Other",
};

/** Why the category is what it is, in a sentence. */
export function categoryReason(latestDecisionReason: string | null, source: string | null): string {
  if (latestDecisionReason) return latestDecisionReason;
  if (source === "manual") return "You corrected this category.";
  if (source === "rule") return "Matched an existing merchant rule.";
  if (source === "ai") return "Suggested automatically.";
  if (source === "system") return "Assigned by the system.";
  return "Not categorized yet.";
}

export function directionLabel(direction: string): string {
  return direction === "in" ? "Money in" : direction === "out" ? "Money out" : "Neutral";
}

/** What the user must do about a transaction whose Space or attribution isn't settled, or null. */
export function attentionMessage(status: AllocationStatus | null | undefined): string | null {
  if (!status || status === "allocated") return null;
  return status === "needs_attribution"
    ? "This household transaction needs an attribution. Say whose spending it was on the web."
    : "This transaction's Space couldn't be determined automatically.";
}

/** Same rule as the web: a known name, else "You" for yourself, else "A member"; no id at all is "Someone". */
export function memberName(userId: string | null, members: readonly Member[], selfUserId: string | null): string {
  if (!userId) return "Someone";
  const named = members.find((m) => m.userId === userId)?.displayName;
  if (named) return named;
  return userId === selfUserId ? "You" : "A member";
}

export type WhereRow = { label: string; value: string };

/** The "Where this came from" rows, in the web's order, omitting what isn't known. */
export function whereFromRows(
  context: TransactionContext,
  members: readonly Member[],
  selfUserId: string | null,
): WhereRow[] {
  const household = context.workspaceKind === "household";
  const rows: WhereRow[] = [];

  if (context.workspaceName) rows.push({ label: "Space", value: context.workspaceName });

  if (context.sourceName) {
    let from = PROVIDER_LABELS[context.sourceProvider ?? ""] ?? context.sourceName;
    if (context.sourceMaskedIdentifier) from += ` · ${context.sourceMaskedIdentifier}`;
    if (household && context.sourceOwnerUserId && context.sourceOwnerUserId !== selfUserId) {
      from += ` · ${memberName(context.sourceOwnerUserId, members, selfUserId)}'s account`;
    }
    rows.push({ label: "From", value: from });
  }

  if (household && context.performedByUserId) {
    rows.push({ label: "Paid by", value: memberName(context.performedByUserId, members, selfUserId) });
  }
  if (
    household &&
    context.recordCreatedByUserId &&
    context.recordCreatedByUserId !== context.performedByUserId
  ) {
    rows.push({ label: "Added by", value: memberName(context.recordCreatedByUserId, members, selfUserId) });
  }
  if (context.ingestionConnectionLabel) {
    rows.push({ label: "Imported via", value: context.ingestionConnectionLabel });
  }
  return rows;
}

/** "Uncategorized → Food · you". The date is added by the screen. */
export function historyLine(entry: CategoryHistoryEntry): { change: string; actor: string } {
  return {
    change: `${entry.previous_category ?? "Uncategorized"} → ${entry.new_category ?? "Uncategorized"}`,
    actor: entry.actor_type === "user" ? "you" : "system",
  };
}
