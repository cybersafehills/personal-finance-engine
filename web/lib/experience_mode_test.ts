import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  experienceModeForWorkspaceKind,
  experienceModeLabel,
  isSurfaceVisible,
  visibleSurfaces,
} from "./experience-mode.ts";

Deno.test("experienceModeForWorkspaceKind maps the three workspace kinds", () => {
  assertEquals(experienceModeForWorkspaceKind("personal"), "personal");
  assertEquals(experienceModeForWorkspaceKind("household"), "household");
  assertEquals(experienceModeForWorkspaceKind("organization"), "business");
  // Unknown / null falls back to the most restrictive surface set.
  assertEquals(experienceModeForWorkspaceKind(null), "personal");
  assertEquals(experienceModeForWorkspaceKind("something-new"), "personal");
});

Deno.test("personal mode hides collaboration, bills, integrations, developer", () => {
  for (
    const s of [
      "members",
      "attribution",
      "bills",
      "integrations",
      "reconciliation",
      "accounting_connectors",
      "developer",
      "directory_admin",
    ] as const
  ) {
    assert(
      !isSurfaceVisible("personal", s, { businessEnabled: true }),
      `personal should not see ${s}`,
    );
  }
  // ...but keeps the core financial journey.
  for (
    const s of [
      "home",
      "activity",
      "inbox",
      "plan",
      "reports",
      "categories",
      "sources",
      "pay",
    ] as const
  ) {
    assert(isSurfaceVisible("personal", s), `personal should see ${s}`);
  }
});

Deno.test("household mode adds members + attribution + import/export, still no bills/dev", () => {
  assert(isSurfaceVisible("household", "members"));
  assert(isSurfaceVisible("household", "attribution"));
  assert(isSurfaceVisible("household", "integrations"));
  assert(!isSurfaceVisible("household", "bills"));
  assert(!isSurfaceVisible("household", "accounting_connectors"));
  assert(!isSurfaceVisible("household", "developer"));
});

Deno.test("business surfaces are dark until businessEnabled is passed", () => {
  // Default: a business Space shows only the household surface set.
  assert(!isSurfaceVisible("business", "bills"));
  assert(!isSurfaceVisible("business", "developer"));
  assert(!isSurfaceVisible("business", "accounting_connectors"));
  assert(isSurfaceVisible("business", "members"));
  assert(isSurfaceVisible("business", "integrations"));

  // Flag on: the business-only surfaces light up.
  assert(isSurfaceVisible("business", "bills", { businessEnabled: true }));
  assert(isSurfaceVisible("business", "developer", { businessEnabled: true }));
  assert(
    isSurfaceVisible("business", "reconciliation", { businessEnabled: true }),
  );
});

Deno.test("directory_admin is never granted by a product mode", () => {
  for (const m of ["personal", "household", "business"] as const) {
    assert(!isSurfaceVisible(m, "directory_admin", { businessEnabled: true }));
  }
});

Deno.test("visibleSurfaces is a subset relationship personal < household < business(on)", () => {
  const p = new Set(visibleSurfaces("personal"));
  const h = new Set(visibleSurfaces("household"));
  const b = new Set(visibleSurfaces("business", { businessEnabled: true }));
  for (const s of p) assert(h.has(s));
  for (const s of h) assert(b.has(s));
  assert(b.size > h.size && h.size > p.size);
});

Deno.test("experienceModeLabel is the customer-facing word", () => {
  assertEquals(experienceModeLabel("personal"), "Personal");
  assertEquals(experienceModeLabel("household"), "Household");
  assertEquals(experienceModeLabel("business"), "Business");
});
