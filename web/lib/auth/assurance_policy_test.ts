import { assertEquals } from "jsr:@std/assert@1";
import { needsMfaStepUp } from "./assurance-policy.ts";

Deno.test("MFA step-up is progressive for users without a factor", () => {
  assertEquals(needsMfaStepUp(0, "aal1"), false);
});

Deno.test("MFA step-up blocks an AAL1 session once a factor is enrolled", () => {
  assertEquals(needsMfaStepUp(1, "aal1"), true);
  assertEquals(needsMfaStepUp(2, null), true);
});

Deno.test("an AAL2 session satisfies MFA step-up", () => {
  assertEquals(needsMfaStepUp(1, "aal2"), false);
});
