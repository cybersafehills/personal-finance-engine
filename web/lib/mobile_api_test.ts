import { assertEquals } from "jsr:@std/assert@1";
import {
  allowedCorsOrigin,
  isMobileApiEnabled,
  mobileAuthRateLimited,
  parseSignInBody,
} from "./mobile-api.ts";

Deno.test("mobile API is dark unless the flag is exactly 'true'", () => {
  assertEquals(isMobileApiEnabled("true"), true);
  assertEquals(isMobileApiEnabled("TRUE"), false);
  assertEquals(isMobileApiEnabled("1"), false);
  assertEquals(isMobileApiEnabled(undefined), false);
});

Deno.test("CORS echoes only exact allowlisted origins", () => {
  const list = "http://localhost:8081, http://localhost:19006";
  assertEquals(
    allowedCorsOrigin("http://localhost:8081", list),
    "http://localhost:8081",
  );
  assertEquals(allowedCorsOrigin("http://localhost:8082", list), null);
  assertEquals(allowedCorsOrigin("https://evil.example", list), null);
  assertEquals(allowedCorsOrigin(null, list), null);
  assertEquals(allowedCorsOrigin("http://localhost:8081", undefined), null);
  assertEquals(allowedCorsOrigin("http://localhost:8081", "*"), null);
});

Deno.test("sign-in body is validated and the email normalised", () => {
  assertEquals(parseSignInBody({ email: " A@B.co ", password: "x" }), {
    email: "a@b.co",
    password: "x",
  });
  assertEquals(parseSignInBody({ email: "nope", password: "x" }), null);
  assertEquals(parseSignInBody({ email: "a@b.co", password: "" }), null);
  assertEquals(parseSignInBody({ email: "a@b.co" }), null);
  assertEquals(parseSignInBody({ email: 1, password: "x" }), null);
  assertEquals(parseSignInBody(null), null);
  assertEquals(parseSignInBody("a@b.co"), null);
  assertEquals(
    parseSignInBody({ email: "a@b.co", password: "x".repeat(1025) }),
    null,
  );
});

Deno.test("per-IP limiter allows 20 per minute then blocks, then resets", () => {
  const ip = "203.0.113.7";
  const t0 = 1_000_000;
  for (let i = 0; i < 20; i++) {
    assertEquals(mobileAuthRateLimited(ip, t0 + i), false);
  }
  assertEquals(mobileAuthRateLimited(ip, t0 + 30), true);
  assertEquals(mobileAuthRateLimited(ip, t0 + 60_001), false);
  assertEquals(mobileAuthRateLimited("203.0.113.8", t0), false);
});
