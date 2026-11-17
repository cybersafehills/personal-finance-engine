import { assertEquals } from "jsr:@std/assert@1";
import { orderForHome } from "./home-wallets.ts";

Deno.test("default wallet comes first, the rest keep their order", () => {
  const out = orderForHome([
    { id: "a", isDefault: false },
    { id: "b", isDefault: true },
    { id: "c", isDefault: false },
  ]);
  assertEquals(out.map((c) => c.id), ["b", "a", "c"]);
});

Deno.test("no default leaves the order alone", () => {
  const out = orderForHome([{ id: "a", isDefault: false }, {
    id: "b",
    isDefault: false,
  }]);
  assertEquals(out.map((c) => c.id), ["a", "b"]);
});

Deno.test("empty stays empty", () => {
  assertEquals(orderForHome([]), []);
});
