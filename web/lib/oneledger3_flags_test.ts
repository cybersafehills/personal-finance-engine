import { assertEquals } from "jsr:@std/assert@1";
import { isOneLedger3FlagEnabled as on } from "./oneledger3-flags.ts";

Deno.test("opt-in: only the exact string 'true' enables; allowlist alone never does", () => {
  for (
    const f of [
      "INSIGHTS_CENTER",
      "BALANCE_PROVENANCE",
      "COUNTERPARTIES",
      "PAYMENT_REQUESTS",
      "FEE_CALCULATOR",
    ] as const
  ) {
    assertEquals(on({}, f, "w"), false);
    assertEquals(on({ [`${f}_ENABLED`]: "TRUE" }, f, "w"), false);
    assertEquals(on({ [`${f}_ENABLED`]: "1" }, f, "w"), false);
    assertEquals(on({ [`${f}_ENABLED`]: "true" }, f, "w"), true);
    assertEquals(on({ [`${f}_WORKSPACE_ALLOWLIST`]: "w" }, f, "w"), false);
  }
});

Deno.test("allowlist restricts when non-empty; flags are independent", () => {
  const env = {
    INSIGHTS_CENTER_ENABLED: "true",
    INSIGHTS_CENTER_WORKSPACE_ALLOWLIST: " a , b ",
  };
  assertEquals(on(env, "INSIGHTS_CENTER", "a"), true);
  assertEquals(on(env, "INSIGHTS_CENTER", "c"), false);
  assertEquals(on(env, "INSIGHTS_CENTER", null), false);
  assertEquals(on(env, "COUNTERPARTIES", "a"), false); // another flag stays off
  assertEquals(
    on(
      { ...env, INSIGHTS_CENTER_WORKSPACE_ALLOWLIST: " " },
      "INSIGHTS_CENTER",
      "zzz",
    ),
    true,
  );
});
