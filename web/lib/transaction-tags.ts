import "server-only";
import { supabaseSession } from "./supabase-session-server";

// Free-form transaction tags (migration 20261217000000). A tag is a short
// member-applied label; the Financial Statements engine can scope a
// statement to one tag. All access is through the caller's session client
// - transaction_tags RLS (workspace membership + created_by + a matching
// transaction workspace) is the boundary.

/** Trim, collapse whitespace, lower-case, and cap at the column's 40 chars. */
export function normalizeTag(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toLowerCase().slice(0, 40);
}

const TAG_RE = /^[\p{L}\p{N} _-]+$/u;

export function isValidTag(tag: string): boolean {
  return tag.length >= 1 && tag.length <= 40 && TAG_RE.test(tag);
}

export type TagActionResult = { ok: true } | { ok: false; error: string };

export async function getTransactionTags(
  transactionId: string,
): Promise<string[]> {
  const supabase = await supabaseSession();
  const { data, error } = await supabase
    .from("transaction_tags")
    .select("tag")
    .eq("transaction_id", transactionId)
    .order("tag", { ascending: true });
  if (error) {
    console.error("getTransactionTags failed:", error.message);
    return [];
  }
  return (data ?? []).map((r) => r.tag as string);
}

/** Distinct tags used anywhere in a workspace - powers the statement filter's suggestions. */
export async function getWorkspaceTags(workspaceId: string): Promise<string[]> {
  const supabase = await supabaseSession();
  const { data, error } = await supabase
    .from("transaction_tags")
    .select("tag")
    .eq("workspace_id", workspaceId)
    .order("tag", { ascending: true })
    .limit(500);
  if (error) {
    console.error("getWorkspaceTags failed:", error.message);
    return [];
  }
  return Array.from(new Set((data ?? []).map((r) => r.tag as string)));
}

export async function addTransactionTag(
  transactionId: string,
  rawTag: string,
): Promise<TagActionResult> {
  const tag = normalizeTag(rawTag);
  if (!isValidTag(tag)) {
    return {
      ok: false,
      error: "A tag is 1-40 letters, numbers, spaces, hyphens or underscores.",
    };
  }

  const supabase = await supabaseSession();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You are not signed in." };

  // RLS lets the caller read the row only if they may see it; this also
  // gives us the workspace to stamp on the tag.
  const { data: txn, error: txnError } = await supabase
    .from("transactions")
    .select("workspace_id")
    .eq("id", transactionId)
    .maybeSingle();
  if (txnError || !txn?.workspace_id) {
    return { ok: false, error: "That transaction isn't available." };
  }

  const { error } = await supabase.from("transaction_tags").insert({
    transaction_id: transactionId,
    workspace_id: txn.workspace_id,
    tag,
    created_by: user.id,
  });
  if (error) {
    // 23505 = unique_violation: the tag is already there, treat as success.
    if (error.code === "23505") return { ok: true };
    console.error("addTransactionTag failed:", error.message);
    return { ok: false, error: "Couldn't add that tag. Try again." };
  }
  return { ok: true };
}

export async function removeTransactionTag(
  transactionId: string,
  rawTag: string,
): Promise<TagActionResult> {
  const tag = normalizeTag(rawTag);
  const supabase = await supabaseSession();
  const { error } = await supabase
    .from("transaction_tags")
    .delete()
    .eq("transaction_id", transactionId)
    .eq("tag", tag);
  if (error) {
    console.error("removeTransactionTag failed:", error.message);
    return { ok: false, error: "Couldn't remove that tag. Try again." };
  }
  return { ok: true };
}
