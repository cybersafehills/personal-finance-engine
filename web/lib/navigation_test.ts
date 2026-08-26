import { assertEquals } from "jsr:@std/assert@1";
import {
  DEFAULT_NAV_ORDER,
  isValidNavOrder,
  normalizeNavOrder,
} from "./navigation.ts";

Deno.test("isValidNavOrder: accepts the default order", () => {
  assertEquals(isValidNavOrder(DEFAULT_NAV_ORDER), true);
});

Deno.test("isValidNavOrder: accepts any permutation of the four allowed keys", () => {
  assertEquals(
    isValidNavOrder(["settings", "budgets", "categories", "transactions"]),
    true,
  );
});

Deno.test("isValidNavOrder: rejects a duplicate entry", () => {
  assertEquals(
    isValidNavOrder(["transactions", "transactions", "budgets", "settings"]),
    false,
  );
});

Deno.test("isValidNavOrder: rejects a missing entry (wrong length)", () => {
  assertEquals(isValidNavOrder(["transactions", "categories", "budgets"]), false);
});

Deno.test("isValidNavOrder: rejects an unknown/malformed value", () => {
  assertEquals(
    isValidNavOrder(["transactions", "categories", "budgets", "reports"]),
    false,
  );
});

Deno.test("isValidNavOrder: rejects Home as a movable entry", () => {
  assertEquals(
    isValidNavOrder(["home", "categories", "budgets", "settings"]),
    false,
  );
});

Deno.test("isValidNavOrder: rejects non-array input", () => {
  assertEquals(isValidNavOrder("transactions,categories,budgets,settings"), false);
  assertEquals(isValidNavOrder(null), false);
  assertEquals(isValidNavOrder(undefined), false);
});

Deno.test("normalizeNavOrder: passes through a valid order unchanged", () => {
  const order = ["settings", "transactions", "budgets", "categories"];
  assertEquals(normalizeNavOrder(order), order);
});

Deno.test("normalizeNavOrder: falls back to the default order for invalid/stale input", () => {
  assertEquals(normalizeNavOrder(["transactions", "categories"]), DEFAULT_NAV_ORDER);
  assertEquals(normalizeNavOrder(null), DEFAULT_NAV_ORDER);
  assertEquals(normalizeNavOrder(undefined), DEFAULT_NAV_ORDER);
});
