import { supabase } from "@/api/supabase";

// Free-form transaction tags, ported from web/lib/transaction-tags.ts. The web
// does these as plain inserts and deletes under the signed-in user's RLS (no MFA
// step, no server-only check), and the database policies enforce what matters:
// at least the `member` role, `created_by = auth.uid()`, and a tag row whose
// workspace matches the transaction's. So the app does the same, directly.

/** Thrown when a tag change could not be saved. The message is user-safe. */
export class TagError extends Error {}

export const MAX_TAG_LENGTH = 40;

/** Trim, collapse whitespace, lower-case, and cap at the column's 40 characters. */
export function normalizeTag(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toLowerCase().slice(0, MAX_TAG_LENGTH);
}

// ASCII punctuation other than "-" and "_". The web allows only letters,
// numbers, spaces, "-" and "_" using a Unicode property escape (\p{L}); that
// syntax isn't used anywhere in the app and isn't verified on Hermes, so this
// is the equivalent written without it: non-ASCII letters (Kinyarwanda and
// French accents) pass, ASCII symbols don't.
const DISALLOWED = /[!-,./:-@[-^`{-~]/;

export function isValidTag(tag: string): boolean {
  return tag.length >= 1 && tag.length <= MAX_TAG_LENGTH && !DISALLOWED.test(tag);
}

export const TAG_RULE_MESSAGE = "A tag is 1-40 letters, numbers, spaces, hyphens or underscores.";

function client() {
  if (!supabase) throw new TagError("This build isn't connected to OneLedger yet.");
  return supabase;
}

/** Adds a tag; adding one that is already there is a success, as on the web. */
export async function addTag(transactionId: string, workspaceId: string, rawTag: string): Promise<string> {
  const tag = normalizeTag(rawTag);
  if (!isValidTag(tag)) throw new TagError(TAG_RULE_MESSAGE);

  const db = client();
  const { data } = await db.auth.getUser();
  if (!data.user) throw new TagError("You are not signed in.");

  const { error } = await db.from("transaction_tags").insert({
    transaction_id: transactionId,
    workspace_id: workspaceId,
    tag,
    created_by: data.user.id,
  });
  if (error && error.code !== "23505") {
    // 23505 = unique violation: already tagged. 42501 = RLS: not allowed here.
    throw new TagError(
      error.code === "42501"
        ? "You can't change tags on this transaction."
        : "Couldn't add that tag. Try again.",
    );
  }
  return tag;
}

export async function removeTag(transactionId: string, rawTag: string): Promise<void> {
  const db = client();
  const tag = normalizeTag(rawTag);

  // Ask for the deleted rows back: under RLS a delete the caller isn't allowed
  // to make is not an error, it just removes nothing (a household viewer can see
  // tags but not delete them).
  const { data, error } = await db
    .from("transaction_tags")
    .delete()
    .eq("transaction_id", transactionId)
    .eq("tag", tag)
    .select("tag");
  if (error) throw new TagError("Couldn't remove that tag. Try again.");
  if ((data ?? []).length > 0) return;

  // Nothing was deleted. Either it was already gone (removed elsewhere: fine) or
  // it is still there and this user isn't allowed to remove it.
  const { data: still, error: readError } = await db
    .from("transaction_tags")
    .select("tag")
    .eq("transaction_id", transactionId)
    .eq("tag", tag);
  if (readError) throw new TagError("Couldn't remove that tag. Try again.");
  if ((still ?? []).length > 0) throw new TagError("You can't change tags on this transaction.");
}

/** Distinct tags used in a Space, to suggest. */
export async function listWorkspaceTags(workspaceId: string): Promise<string[]> {
  const { data, error } = await client()
    .from("transaction_tags")
    .select("tag")
    .eq("workspace_id", workspaceId)
    .order("tag", { ascending: true })
    .limit(500);
  if (error) throw new TagError("tags unavailable");
  return Array.from(new Set((data ?? []).map((r) => r.tag as string)));
}

/** Suggestions not already applied, at most eight (as on the web). */
export function unusedSuggestions(suggestions: readonly string[], applied: readonly string[]): string[] {
  return suggestions.filter((s) => !applied.includes(s)).slice(0, 8);
}
