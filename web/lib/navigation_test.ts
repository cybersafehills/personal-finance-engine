import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  MORE_GROUPS,
  MORE_MENU_PREFIXES,
  PHONE_BAR_KEYS,
  PRIMARY_NAV,
} from "./navigation.ts";

Deno.test("PRIMARY_NAV is the fixed financial journey, Home first", () => {
  assertEquals(
    PRIMARY_NAV.map((i) => i.key),
    ["home", "activity", "inbox", "plan"],
  );
  assertEquals(PRIMARY_NAV[0].href, "/");
  // Existing deep-link routes are preserved under the new labels.
  assertEquals(
    PRIMARY_NAV.find((i) => i.key === "activity")?.href,
    "/transactions",
  );
  assertEquals(PRIMARY_NAV.find((i) => i.key === "plan")?.href, "/budgets");
});

Deno.test("Home and Inbox are not on the phone bottom bar (5 slots: Home, Activity, Pay, Plan, More)", () => {
  assert(!(PHONE_BAR_KEYS as readonly string[]).includes("home"));
  assert(!(PHONE_BAR_KEYS as readonly string[]).includes("inbox"));
  assertEquals([...PHONE_BAR_KEYS], ["activity", "plan"]);
});

Deno.test("MORE_MENU_PREFIXES no longer claims /inbox (it is a primary destination now)", () => {
  assert(!(MORE_MENU_PREFIXES as readonly string[]).includes("/inbox"));
  assert((MORE_MENU_PREFIXES as readonly string[]).includes("/settings"));
});

Deno.test("MORE_GROUPS: every item has a customer-language label and a real path", () => {
  const banned = /ingestion|endpoint|header|\bjson\b|credential/i;
  for (const group of MORE_GROUPS) {
    assert(group.items.length > 0, `${group.title} has items`);
    for (const item of group.items) {
      assert(item.href.startsWith("/"), `${item.label} href is a path`);
      assert(!banned.test(item.label), `${item.label} avoids data-model terms`);
    }
  }
});

Deno.test("MORE_GROUPS: the Account group is always visible (no surface gate)", () => {
  const account = MORE_GROUPS.find((g) => g.title === "Account");
  assert(account);
  for (const item of account.items) {
    assertEquals(item.surface, null);
  }
});

Deno.test("MORE_GROUPS: Advanced + Pay items are surface-gated and flag-gated", () => {
  const advanced = MORE_GROUPS.find((g) => g.title === "Advanced");
  assert(advanced);
  for (const item of advanced.items) {
    assert(item.surface !== null);
    assertEquals(item.requires, "integrations");
  }
});
