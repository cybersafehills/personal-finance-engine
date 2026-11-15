import { assertEquals } from "jsr:@std/assert@1";
import {
  excludeLinkedTransfers,
  linkedTransferIdSet,
} from "./transfer-exclusion.ts";

Deno.test("linkedTransferIdSet collects both legs", () => {
  const s = linkedTransferIdSet([
    { out_transaction_id: "a", in_transaction_id: "b" },
    { out_transaction_id: "c", in_transaction_id: "d" },
  ]);
  assertEquals([...s].sort(), ["a", "b", "c", "d"]);
});

Deno.test("excludeLinkedTransfers drops linked legs only, keeps order", () => {
  const rows = [{ id: "a" }, { id: "x" }, { id: "b" }, { id: "y" }];
  const out = excludeLinkedTransfers(rows, new Set(["a", "b"]));
  assertEquals(out.map((r) => r.id), ["x", "y"]);
  assertEquals(excludeLinkedTransfers(rows, new Set()).length, 4);
});
