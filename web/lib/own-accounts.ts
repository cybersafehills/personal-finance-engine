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
type Client = { from(table: string): any };

const PAGE = 1000;
const MAX_PAGES = 20; // 20k rows: far beyond any one user's own-account history

export async function ownAccountTransactionIds(
  supabase: Client,
  workspaceId: string | null,
  opts: { strict?: boolean } = {},
): Promise<Set<string>> {
  const fail = (what: string, message: string): Set<string> => {
    if (opts.strict) {
      throw new Error(`ownAccountTransactionIds ${what}: ${message}`);
    }
    console.error(`ownAccountTransactionIds ${what} failed:`, message);
    return new Set();
  };

  let selfQuery = supabase
    .from("counterparties")
    .select("id")
    .eq("kind", "self")
    .is("merged_into_id", null)
    .limit(1000);
  if (workspaceId) selfQuery = selfQuery.eq("workspace_id", workspaceId);
  const selfRes = await selfQuery;
  if (selfRes.error) return fail("counterparties", selfRes.error.message);
  const selfIds = ((selfRes.data ?? []) as { id: string }[]).map((r) => r.id);
  if (selfIds.length === 0) return new Set();

  const mergedRes = await supabase
    .from("counterparties")
    .select("id")
    .in("merged_into_id", selfIds)
    .limit(5000);
  if (mergedRes.error) {
    return fail("merged counterparties", mergedRes.error.message);
  }
  const allIds = [
    ...selfIds,
    ...((mergedRes.data ?? []) as { id: string }[]).map((r) => r.id),
  ];

  const ids = new Set<string>();
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await supabase
      .from("transactions")
      .select("id")
      .in("counterparty_id", allIds)
      .order("id", { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) return fail("transactions", error.message);
    for (const r of (data ?? []) as { id: string }[]) ids.add(r.id);
    if (!data || data.length < PAGE) break;
  }
  return ids;
}
