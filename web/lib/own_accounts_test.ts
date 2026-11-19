import { assertEquals } from "jsr:@std/assert@1";
import { ownAccountTransactionIds } from "./own-accounts.ts";

// A tiny chainable fake of the few PostgREST calls the helper makes.
type Rows = Record<string, Record<string, unknown>[]>;
function fakeClient(tables: Rows, failOn?: string) {
  return {
    from(table: string) {
      const filters: ((r: Record<string, unknown>) => boolean)[] = [];
      let from = 0, to = Infinity;
      const q = {
        select: () => q,
        eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), q),
        is: (
          k: string,
          v: unknown,
        ) => (filters.push((r) => (r[k] ?? null) === v), q),
        in: (
          k: string,
          vs: unknown[],
        ) => (filters.push((r) => vs.includes(r[k])), q),
        order: () => q,
        limit: () => q,
        range: (a: number, b: number) => ((from = a), (to = b), q),
        then: (resolve: (v: unknown) => void) => {
          if (failOn === table) {
            return resolve({ data: null, error: { message: "boom" } });
          }
          const rows = (tables[table] ?? []).filter((r) =>
            filters.every((f) => f(r))
          );
          resolve({
            data: rows.slice(from, to === Infinity ? undefined : to + 1),
            error: null,
          });
        },
      };
      return q;
    },
    // deno-lint-ignore no-explicit-any
  } as any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

const cps = [
  { id: "me", kind: "self", merged_into_id: null, workspace_id: "w" },
  { id: "me2", kind: "person", merged_into_id: "me", workspace_id: "w" }, // merged into "me"
  { id: "bob", kind: "person", merged_into_id: null, workspace_id: "w" },
  { id: "me-other-ws", kind: "self", merged_into_id: null, workspace_id: "x" },
];
const txns = [
  { id: "t1", counterparty_id: "me", workspace_id: "w" },
  { id: "t2", counterparty_id: "me2", workspace_id: "w" },
  { id: "t3", counterparty_id: "bob", workspace_id: "w" },
  { id: "t4", counterparty_id: "me-other-ws", workspace_id: "x" },
];

Deno.test("own-account transactions include ones on a merged duplicate, and exclude other people", async () => {
  const ids = await ownAccountTransactionIds(
    fakeClient({ counterparties: cps, transactions: txns }),
    "w",
  );
  assertEquals([...ids].sort(), ["t1", "t2"]);
});

Deno.test("without a workspace it reads every visible Space (RLS decides)", async () => {
  const ids = await ownAccountTransactionIds(
    fakeClient({ counterparties: cps, transactions: txns }),
    null,
  );
  assertEquals([...ids].sort(), ["t1", "t2", "t4"]);
});

Deno.test("nobody marked: empty set and no transaction query", async () => {
  const ids = await ownAccountTransactionIds(
    fakeClient({
      counterparties: [{
        id: "bob",
        kind: "person",
        merged_into_id: null,
        workspace_id: "w",
      }],
      transactions: txns,
    }),
    "w",
  );
  assertEquals(ids.size, 0);
});

Deno.test("a failed own-account lookup never silently returns an empty exclusion set", async () => {
  const bad = fakeClient(
    { counterparties: cps, transactions: txns },
    "transactions",
  );
  let threw = false;
  try {
    await ownAccountTransactionIds(bad, "w");
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});
