import { supabase } from "@/api/supabase";

import type { Member } from "./detailDisplay";

// "Whose spending is this?" on a household transaction, ported from the web's
// TransactionAttributionPanel and its setTransactionAttribution action. The web
// action is a thin wrapper over the set_transaction_attribution database
// function (no MFA step), and that function enforces everything that matters:
// household-only, the caller can see the source, the caller has the
// `transaction.categorize` capability, every named member is active, and a
// split totals 10000 basis points (a constraint trigger). So the app calls it
// directly under RLS, like tags and category corrections. It changes how an
// expense is COUNTED in household reports; it never moves money.

export type AttributionType = "shared" | "member" | "split" | "unassigned";

export type MemberSplit = { userId: string; shareBps: number };

export type Attribution = {
  type: AttributionType | null;
  attributedUserId: string | null;
  splits: MemberSplit[];
};

/** Thrown when a change could not be saved. The message is user-safe. */
export class AttributionError extends Error {}

export const FULL_BPS = 10_000;

export const ATTRIBUTION_OPTIONS: { value: AttributionType; label: string }[] = [
  { value: "shared", label: "Shared: belongs to the household" },
  { value: "member", label: "One member" },
  { value: "split", label: "Split across members" },
  { value: "unassigned", label: "Not sure yet" },
];

const nameOf = (members: readonly Member[], userId: string | null, selfUserId: string | null): string => {
  if (!userId) return "Someone";
  const named = members.find((m) => m.userId === userId)?.displayName;
  if (named) return named;
  return userId === selfUserId ? "You" : "A member";
};

export const memberDisplayName = nameOf;

/** The one-line summary of the current attribution, as the web words it. */
export function attributionSummary(
  current: Attribution,
  members: readonly Member[],
  selfUserId: string | null,
): string {
  if (current.type === "member") return nameOf(members, current.attributedUserId, selfUserId);
  if (current.type === "split") {
    return current.splits
      .map((s) => `${nameOf(members, s.userId, selfUserId)} ${Math.round(s.shareBps / 100)}%`)
      .join(" · ");
  }
  if (current.type === "shared") return "Shared by the household";
  return "Not decided yet";
}

/** Whether to flag it as needing a decision (never decided, or "not sure yet"). */
export const needsAttribution = (current: Attribution): boolean =>
  current.type === null || current.type === "unassigned";

// ---------------------------------------------------------------------------
// The split editor. A percentage box per member (blank or 0 = not included), so
// the same member can't appear twice by construction. All arithmetic is in whole
// basis points: summing percentages as floats makes three equal thirds miss 100.
// ---------------------------------------------------------------------------

export type SplitRow = { userId: string; percentText: string };

/** One row per member, prefilled from the current split (or empty). */
export function initialSplitRows(members: readonly Member[], current: readonly MemberSplit[]): SplitRow[] {
  return members.map((m) => {
    const existing = current.find((s) => s.userId === m.userId);
    return { userId: m.userId, percentText: existing ? formatPercent(existing.shareBps) : "" };
  });
}

/** 5000 -> "50", 3333 -> "33.33". */
export function formatPercent(bps: number): string {
  const percent = bps / 100;
  return Number.isInteger(percent) ? `${percent}` : percent.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

/** Basis points from what was typed ("33.33", "50", ""), or null when it isn't a usable percentage. */
export function percentTextToBps(text: string): number | null {
  const t = text.trim().replace(/%$/, "").trim();
  if (t === "") return 0;
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(t)) return null;
  const bps = Math.round(Number(t) * 100);
  return bps >= 0 && bps <= FULL_BPS ? bps : null;
}

export type SplitCheck =
  | { ok: true; splits: MemberSplit[]; totalBps: number }
  | { ok: false; totalBps: number; message: string };

/** The rows as a split, or why they can't be saved yet. Only members with a share above 0 are included. */
export function checkSplit(rows: readonly SplitRow[]): SplitCheck {
  let total = 0;
  const splits: MemberSplit[] = [];
  for (const row of rows) {
    const bps = percentTextToBps(row.percentText);
    if (bps === null) return { ok: false, totalBps: total, message: "Enter each share as a percentage, like 50 or 33.33." };
    total += bps;
    if (bps > 0) splits.push({ userId: row.userId, shareBps: bps });
  }
  if (splits.length === 0) return { ok: false, totalBps: total, message: "Give at least one member a share." };
  if (total !== FULL_BPS) return { ok: false, totalBps: total, message: "The shares must add up to 100%." };
  return { ok: true, splits, totalBps: total };
}

/** "60%" of 100 etc., for the running total under the editor. */
export const totalLabel = (totalBps: number): string => `${formatPercent(totalBps)}% of 100%`;

// ---------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------

export type AttributionChange =
  | { type: "shared" | "unassigned" }
  | { type: "member"; memberId: string }
  | { type: "split"; splits: MemberSplit[] };

function client() {
  if (!supabase) throw new AttributionError("This build isn't connected to OneLedger yet.");
  return supabase;
}

/**
 * Saves the change and returns what was saved. The database function replaces
 * any earlier split and the attribution in one step. Its own refusals ("You do
 * not have permission to categorize transactions in this Space.", "That person is
 * not an active member of this Space.") are plain sentences raised with
 * `raise exception` (P0001) and are shown as they are; any other database error
 * gets a generic message instead of leaking internals.
 */
export async function setAttribution(transactionId: string, change: AttributionChange): Promise<Attribution> {
  const { error } = await client().rpc("set_transaction_attribution", {
    p_transaction_id: transactionId,
    p_attribution_type: change.type,
    p_attributed_user_id: change.type === "member" ? change.memberId : null,
    p_splits:
      change.type === "split"
        ? change.splits.map((s) => ({ user_id: s.userId, share_bps: s.shareBps }))
        : null,
  });
  if (error) {
    const own = error.code === "P0001" && error.message.length > 0 && error.message.length <= 200;
    throw new AttributionError(own ? error.message : "Couldn't save that. Check your connection and try again.");
  }
  return {
    type: change.type,
    attributedUserId: change.type === "member" ? change.memberId : null,
    splits: change.type === "split" ? change.splits : [],
  };
}

/** The split rows behind a "split" attribution; null when they could not be read. */
export async function getMemberSplits(transactionId: string): Promise<MemberSplit[]> {
  const { data, error } = await client()
    .from("transaction_member_attributions")
    .select("user_id, share_bps")
    .eq("transaction_id", transactionId);
  if (error) throw new AttributionError("splits unavailable");
  return ((data ?? []) as { user_id: string; share_bps: number }[]).map((r) => ({
    userId: r.user_id,
    shareBps: r.share_bps,
  }));
}
