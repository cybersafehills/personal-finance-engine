import { assertEquals } from "jsr:@std/assert@1";
import {
  MARKETPLACE_CATALOG,
  MARKETPLACE_CATEGORY_META,
  MARKETPLACE_STATUS_META,
  marketplaceByCategory,
  marketplaceStatusCounts,
} from "./catalog.ts";

Deno.test("every entry has a unique key", () => {
  const keys = MARKETPLACE_CATALOG.map((entry) => entry.key);
  assertEquals(new Set(keys).size, keys.length);
});

Deno.test("every entry documents itself with a repo-relative .md path", () => {
  for (const entry of MARKETPLACE_CATALOG) {
    assertEquals(
      entry.docHref.startsWith("docs/") && entry.docHref.endsWith(".md"),
      true,
      `bad docHref on ${entry.key}: ${entry.docHref}`,
    );
  }
});

Deno.test("a coming_soon entry is never made to look reachable", () => {
  for (const entry of MARKETPLACE_CATALOG) {
    if (entry.status === "coming_soon") {
      assertEquals(
        entry.configHref,
        null,
        `${entry.key} is coming_soon but links to ${entry.configHref}`,
      );
    }
  }
});

Deno.test("any configHref points inside the integrations area", () => {
  for (const entry of MARKETPLACE_CATALOG) {
    if (entry.configHref !== null) {
      assertEquals(
        entry.configHref.startsWith("/integrations/"),
        true,
        `${entry.key} configHref escapes /integrations: ${entry.configHref}`,
      );
    }
  }
});

Deno.test("every category and status used has display metadata", () => {
  for (const entry of MARKETPLACE_CATALOG) {
    assertEquals(
      typeof MARKETPLACE_CATEGORY_META[entry.category]?.label,
      "string",
    );
    assertEquals(
      typeof MARKETPLACE_STATUS_META[entry.status]?.label,
      "string",
    );
  }
});

Deno.test("marketplaceByCategory covers every entry once, in category order", () => {
  const groups = marketplaceByCategory();

  const orders = groups.map(
    (group) => MARKETPLACE_CATEGORY_META[group.category].order,
  );
  assertEquals(orders, [...orders].sort((a, b) => a - b));

  const grouped = groups.flatMap((group) => group.entries);
  assertEquals(grouped.length, MARKETPLACE_CATALOG.length);
  assertEquals(
    new Set(grouped.map((entry) => entry.key)).size,
    MARKETPLACE_CATALOG.length,
  );
  for (const group of groups) {
    assertEquals(group.entries.length > 0, true);
  }
});

Deno.test("status counts sum to the catalogue size", () => {
  const counts = marketplaceStatusCounts();
  assertEquals(
    counts.available + counts.beta + counts.coming_soon,
    MARKETPLACE_CATALOG.length,
  );
});
