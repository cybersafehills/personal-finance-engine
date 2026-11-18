import { assertEquals } from "jsr:@std/assert@1";
import { buildEffectiveMap, resolveCounterparty } from "./effective.ts";

const rows = [
  { id: "a", display_name: "Sam", merged_into_id: null },
  { id: "b", display_name: "Sam (old number)", merged_into_id: "a" },
  { id: "c", display_name: "Samuel", merged_into_id: "b" }, // a quirk: two hops
  { id: "x", display_name: "Shop", merged_into_id: null },
  { id: "loop1", display_name: "L1", merged_into_id: "loop2" },
  { id: "loop2", display_name: "L2", merged_into_id: "loop1" },
];

Deno.test("merged counterparties resolve to the survivor and its name", () => {
  const m = buildEffectiveMap(rows);
  assertEquals(m.get("a"), { id: "a", displayName: "Sam" });
  assertEquals(m.get("b"), { id: "a", displayName: "Sam" });
  assertEquals(m.get("c"), { id: "a", displayName: "Sam" });
  assertEquals(m.get("x"), { id: "x", displayName: "Shop" });
});

Deno.test("a pointer cycle terminates instead of looping", () => {
  const m = buildEffectiveMap(rows);
  assertEquals(m.has("loop1") && m.has("loop2"), true);
});

Deno.test("transactions resolve by effective id; unresolved ones keep their raw label", () => {
  const m = buildEffectiveMap(rows);
  assertEquals(resolveCounterparty("b", "SAM RAW", m), {
    counterpartyId: "a",
    counterpartyName: "Sam",
  });
  assertEquals(resolveCounterparty(null, "Just a name", m), {
    counterpartyId: null,
    counterpartyName: "Just a name",
  });
  assertEquals(resolveCounterparty("unknown-id", "Raw", m), {
    counterpartyId: "unknown-id",
    counterpartyName: "Raw",
  });
});

Deno.test("merging changes the grouping key: two raw ids become one effective id", () => {
  const m = buildEffectiveMap(rows);
  const keys = new Set(
    ["a", "b"].map((id) => resolveCounterparty(id, null, m).counterpartyId),
  );
  assertEquals(keys.size, 1);
});
