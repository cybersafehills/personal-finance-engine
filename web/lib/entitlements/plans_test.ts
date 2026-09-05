import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  ENTITLEMENTS,
  type Entitlement,
  isPlan,
  lowestPlanFor,
  PLANS,
  planEntitlements,
  planHasEntitlement,
  planLabel,
} from "./plans.ts";

Deno.test("Free grants no entitlements", () => {
  assertEquals(planEntitlements("free"), []);
});

Deno.test("tiers are supersets: free ⊂ personal_plus ⊂ household ⊂ business", () => {
  const chains: [typeof PLANS[number], typeof PLANS[number]][] = [
    ["free", "personal_plus"],
    ["personal_plus", "household"],
    ["household", "business"],
  ];
  for (const [lower, higher] of chains) {
    for (const e of planEntitlements(lower)) {
      assert(
        planHasEntitlement(higher, e),
        `${higher} should also grant ${e}`,
      );
    }
    assert(
      planEntitlements(higher).length > planEntitlements(lower).length,
      `${higher} adds something over ${lower}`,
    );
  }
});

Deno.test("collaboration entitlements start at Household, not Personal Plus", () => {
  for (const e of ["shared_space", "space_members", "source_sharing"] as const) {
    assert(!planHasEntitlement("personal_plus", e));
    assert(planHasEntitlement("household", e));
  }
});

Deno.test("operational-control entitlements start at Business", () => {
  for (const e of ["approvals", "bills", "reconciliation", "audit_retention"] as const) {
    assert(!planHasEntitlement("household", e));
    assert(planHasEntitlement("business", e));
  }
});

Deno.test("every entitlement is granted by at least one plan", () => {
  for (const e of ENTITLEMENTS) {
    assert(lowestPlanFor(e as Entitlement) !== null, `${e} is unreachable`);
  }
});

Deno.test("lowestPlanFor returns the cheapest tier that unlocks it", () => {
  assertEquals(lowestPlanFor("automated_ingestion"), "personal_plus");
  assertEquals(lowestPlanFor("shared_goals"), "household");
  assertEquals(lowestPlanFor("approvals"), "business");
});

Deno.test("no data/export/deletion/security entitlement exists (assessment guardrail)", () => {
  const banned = /export|delete|deletion|backup|download|security|password|mfa|own_data|ledger_access/i;
  for (const e of ENTITLEMENTS) {
    assert(!banned.test(e), `${e} looks like it gates a user's own data/security`);
  }
});

Deno.test("planLabel + isPlan", () => {
  assertEquals(planLabel("personal_plus"), "Personal Plus");
  assert(isPlan("business"));
  assert(!isPlan("enterprise"));
  assert(!isPlan(null));
});
