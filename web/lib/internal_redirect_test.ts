import { assertEquals } from "jsr:@std/assert@1";
import { internalRedirectPath } from "./internal-redirect.ts";

Deno.test("internalRedirectPath preserves safe application paths", () => {
  assertEquals(internalRedirectPath("/"), "/");
  assertEquals(
    internalRedirectPath("/invite/abc?from=email#accept"),
    "/invite/abc?from=email#accept",
  );
  assertEquals(
    internalRedirectPath("/auth/reset-password/confirm"),
    "/auth/reset-password/confirm",
  );
});

Deno.test("internalRedirectPath rejects cross-origin and malformed targets", () => {
  for (
    const target of [
      "https://attacker.example/",
      "//attacker.example/",
      "/\\attacker.example/",
      "javascript:alert(1)",
      "dashboard",
      "/safe\nLocation: https://attacker.example/",
      null,
      undefined,
    ]
  ) {
    assertEquals(internalRedirectPath(target), "/");
  }
});

Deno.test("internalRedirectPath supports an explicit safe fallback", () => {
  assertEquals(internalRedirectPath("//attacker.example", "/login"), "/login");
});
