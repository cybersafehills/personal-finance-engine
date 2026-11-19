// Transactions with a counterparty you have marked as your OWN account.
//
// Money moving between your own accounts is neither income nor spending. Confirmed
// transfer links already exclude both legs when they can be matched; marking a name
// as "me" (People and merchants > kind "My account") covers the rest - a bank top-up
// whose other leg never arrives, a transfer to savings you do not track. Every
// summary surface unions these ids into the same exclusion set it already uses.
//
// Reads through the caller's session (RLS decides what is visible). Merged
// counterparties follow their survivor, so merging a duplicate "me" into "me" works.

// The few PostgREST calls used here, typed structurally so this stays testable
// under `deno test` (no package import) and accepts any Supabase client.
// deno-lint-ignore no-explicit-any
type Client = { from(table: string): any }; // eslint-disable-line @typescript-eslint/no-explicit-any

import { completePages } from "../shared/financial.ts";
export async function ownAccountTransactionIds(
  supabase: Client,
  workspaceId: string | null,
  opts: { strict?: boolean } = {},
): Promise<Set<string>> {
  void opts; // retained call signature; financial read failures always propagate.
  const people = await completePages<
    { id: string; kind: string; merged_into_id: string | null }
  >(async (offset, size) => {
    let query = supabase.from("counterparties").select("id,kind,merged_into_id")
      .order("id");
    if (workspaceId) query = query.eq("workspace_id", workspaceId);
    const { data, error } = await query.range(offset, offset + size - 1);
    if (error) throw new Error("Own-account classification is unavailable.");
    return data ?? [];
  });
  const byId = new Map(people.map((p) => [p.id, p]));
  const selfIds = people.filter((p) => {
    let current: typeof p | undefined = p;
    const seen = new Set<string>();
    while (current) {
      if (seen.has(current.id)) {
        throw new Error("Invalid counterparty merge cycle.");
      }
      seen.add(current.id);
      if (!current.merged_into_id) return current.kind === "self";
      current = byId.get(current.merged_into_id);
    }
    return false;
  }).map((p) => p.id);
  const ids = new Set<string>();
  for (let start = 0; start < selfIds.length; start += 200) {
    const group = selfIds.slice(start, start + 200);
    const rows = await completePages<{ id: string }>(async (offset, size) => {
      let query = supabase.from("transactions").select("id").in(
        "counterparty_id",
        group,
      ).order("id");
      if (workspaceId) query = query.eq("workspace_id", workspaceId);
      const { data, error } = await query.range(offset, offset + size - 1);
      if (error) throw new Error("Own-account history is unavailable.");
      return data ?? [];
    });
    rows.forEach((r) => ids.add(r.id));
  }
  return ids;
}
