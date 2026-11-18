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

Deno.test("MORE_GROUPS: Payment requests is in Pay & Services, pay-surface and gated only by its own flag", () => {
  const pay = MORE_GROUPS.find((g) => g.title === "Pay & Services");
  assert(pay);
  const item = pay.items.find((i) => i.href === "/pay/requests");
  assert(item);
  assertEquals(item.label, "Payment requests");
  assertEquals(item.surface, "pay");
  assertEquals(item.requires, "paymentRequests");
  assertEquals(item.icon, "requests");
});

Deno.test("MORE_GROUPS: People and merchants is in Manage money, ungated by mode and gated only by its own flag", () => {
  const group = MORE_GROUPS.find((g) => g.title === "Manage money");
  assert(group);
  const item = group.items.find((i) => i.href === "/people");
  assert(item);
  assertEquals(item.label, "People and merchants");
  assertEquals(item.surface, null);
  assertEquals(item.requires, "counterparties");
  assertEquals(item.icon, "people");
});

Deno.test("MORE_GROUPS: Wallets, Goals, Insights and the forecast are reachable, each gated by only its own flag", () => {
  const find = (href: string) =>
    MORE_GROUPS.flatMap((g) => g.items).find((i) => i.href === href);
  assertEquals(find("/wallets")?.requires, "wallets");
  assertEquals(find("/insights")?.requires, "insights");
  assertEquals(find("/inbox/forecast")?.requires, "forecast");
  // Goals are part of Plan: visible whenever Plan is, no extra flag.
  assertEquals(find("/budgets/goals")?.requires, undefined);
  assertEquals(find("/budgets/goals")?.surface, "plan");
});

Deno.test("More highlights for Wallets and Insights pages", () => {
  assert((MORE_MENU_PREFIXES as readonly string[]).includes("/wallets"));
  assert((MORE_MENU_PREFIXES as readonly string[]).includes("/insights"));
});
