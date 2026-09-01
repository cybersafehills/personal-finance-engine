import { assertEquals } from "jsr:@std/assert@1";
import { verificationFailureStatus } from "./auth-callback.ts";

Deno.test("verification callback classifies missing and expired links", () => {
  assertEquals(verificationFailureStatus(null), "missing");
  assertEquals(
    verificationFailureStatus({
      code: "otp_expired",
      message: "Email link is expired",
    }),
    "expired",
  );
});

Deno.test("verification callback treats unknown, reused, and malformed codes as invalid", () => {
  assertEquals(
    verificationFailureStatus({
      message: "invalid request: code verifier missing",
    }),
    "invalid",
  );
});
