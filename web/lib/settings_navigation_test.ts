import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  allSettingsHrefs,
  isSettingsRowVisible,
  SETTINGS_GROUPS,
  type SettingsNavContext,
  visibleSettingsGroups,
} from "./settings-navigation.ts";

const ALL_VISIBLE: SettingsNavContext = {
  spacesEnabled: true,
  surfaceVisible: () => true,
};

Deno.test("SETTINGS_GROUPS is the seven named groups in section-110 order", () => {
  assertEquals(
    SETTINGS_GROUPS.map((g) => g.key),
    ["profile", "accounts", "spaces", "reports", "data", "security", "billing"],
  );
  for (const group of SETTINGS_GROUPS) {
    assert(group.title.length > 0, `${group.key} has a title`);
    assert(group.description.length > 0, `${group.key} has a description`);
    assert(group.rows.length > 0, `${group.key} has at least one row`);
  }
});

Deno.test("every row has a real in-app path, a label, and a one-line description", () => {
  for (const group of SETTINGS_GROUPS) {
    for (const row of group.rows) {
      assert(row.href.startsWith("/"), `${row.label} href is an app path`);
      assert(row.label.length > 0, `${row.href} has a label`);
      assert(
        row.description.length > 0 && !/\byou should\b/i.test(row.description),
        `${row.href} description is present and not preachy`,
      );
    }
  }
});

Deno.test("no href appears in two groups", () => {
  const hrefs = allSettingsHrefs();
  assertEquals(hrefs.length, new Set(hrefs).size);
});

Deno.test("the duplicated Security naming is resolved into one group", () => {
  const securityGroups = SETTINGS_GROUPS.filter((g) =>
    /security/i.test(g.title)
  );
  assertEquals(securityGroups.length, 1);
  const hrefs = securityGroups[0].rows.map((r) => r.href);
  assert(hrefs.includes("/settings/security"));
  assert(hrefs.includes("/settings/privacy"));
});

Deno.test("'Shared accounts' is folded into Spaces & Members, not a top-level group", () => {
  assert(!SETTINGS_GROUPS.some((g) => /shared accounts/i.test(g.title)));
  const spaces = SETTINGS_GROUPS.find((g) => g.key === "spaces")!;
  assert(spaces.rows.some((r) => r.href === "/settings/sources"));
});

Deno.test("there is a home for Billing & Plan", () => {
  const billing = SETTINGS_GROUPS.find((g) => g.key === "billing")!;
  assertEquals(billing.rows[0].href, "/settings/billing");
});

Deno.test("Account sharing is hidden when shared Spaces are disabled", () => {
  const sharingRow = SETTINGS_GROUPS.find((g) => g.key === "spaces")!
    .rows.find((r) => r.href === "/settings/sources")!;
  assert(isSettingsRowVisible(sharingRow, ALL_VISIBLE));
  assert(
    !isSettingsRowVisible(sharingRow, {
      spacesEnabled: false,
      surfaceVisible: () => true,
    }),
  );
});

Deno.test("a Personal user (no integrations/developer surface) does not see Data & Integrations", () => {
  const personal: SettingsNavContext = {
    spacesEnabled: false,
    surfaceVisible: (s) => s !== "integrations" && s !== "developer",
  };
  const groups = visibleSettingsGroups(personal);
  assert(!groups.some((g) => g.key === "data"));
  // The always-on groups still render.
  for (const key of ["profile", "accounts", "spaces", "reports", "security", "billing"]) {
    assert(groups.some((g) => g.key === key), `${key} still visible`);
  }
});

Deno.test("a Household user sees Integrations but not the Developer platform", () => {
  const household: SettingsNavContext = {
    spacesEnabled: true,
    surfaceVisible: (s) => s !== "developer",
  };
  const data = visibleSettingsGroups(household).find((g) => g.key === "data");
  assert(data);
  assertEquals(data!.rows.map((r) => r.href), ["/integrations"]);
});

Deno.test("visibleSettingsGroups drops empty groups and preserves order", () => {
  const groups = visibleSettingsGroups(ALL_VISIBLE);
  assertEquals(
    groups.map((g) => g.key),
    SETTINGS_GROUPS.map((g) => g.key),
  );
});
