import { assertEquals } from "jsr:@std/assert@1";
import {
  allowedCorsOrigin,
  bearerToken,
  corsHeadersFor,
  getUserForRequest,
  isMobileApiEnabled,
  mfaSatisfied,
  mobileAuthRateLimited,
  parseSignInBody,
  tokenAal,
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

Deno.test("bearerToken accepts only a well-formed Bearer header", () => {
  assertEquals(bearerToken("Bearer abc.def.ghi"), "abc.def.ghi");
  assertEquals(bearerToken("bearer   abc "), "abc");
  assertEquals(bearerToken("Basic abc"), null);
  assertEquals(bearerToken("Bearer"), null);
  assertEquals(bearerToken("Bearer a b"), null);
  assertEquals(bearerToken(null), null);
});

function jwtWith(claims: Record<string, unknown>): string {
  const enc = (o: unknown) =>
    btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${enc({ alg: "HS256" })}.${enc(claims)}.sig`;
}

Deno.test("tokenAal reads the assurance level claim", () => {
  assertEquals(tokenAal(jwtWith({ aal: "aal2" })), "aal2");
  assertEquals(tokenAal(jwtWith({ aal: "aal1" })), "aal1");
  assertEquals(tokenAal(jwtWith({ aal: "aal3" })), null);
  assertEquals(tokenAal(jwtWith({})), null);
  assertEquals(tokenAal("not-a-jwt"), null);
  assertEquals(tokenAal("a.%%%.c"), null);
});

Deno.test("a verified second factor must be completed (aal2)", () => {
  const verified = [{ status: "verified" }];
  assertEquals(mfaSatisfied("aal1", verified), false);
  assertEquals(mfaSatisfied(null, verified), false);
  assertEquals(mfaSatisfied("aal2", verified), true);
  // No verified factor: password alone is the account's strongest level.
  assertEquals(mfaSatisfied("aal1", []), true);
  assertEquals(mfaSatisfied("aal1", [{ status: "unverified" }]), true);
  assertEquals(mfaSatisfied("aal1", undefined), true);
});

Deno.test("corsHeadersFor allows the Authorization header for allowlisted origins only", () => {
  const h = corsHeadersFor("http://localhost:8081", "http://localhost:8081", "GET, OPTIONS");
  assertEquals(h["Access-Control-Allow-Origin"], "http://localhost:8081");
  assertEquals(h["Access-Control-Allow-Headers"], "content-type, authorization");
  assertEquals(corsHeadersFor("https://evil.example", "http://localhost:8081", "GET"), {});
  assertEquals(corsHeadersFor("http://localhost:8081", undefined, "GET"), {});
});

Deno.test("rate limiter honours a custom ceiling", () => {
  const ip = "10.9.9.9";
  const t = 5_000_000;
  for (let i = 0; i < 3; i++) assertEquals(mobileAuthRateLimited(ip, t, 3), false);
  assertEquals(mobileAuthRateLimited(ip, t, 3), true);
});

Deno.test("getUserForRequest asks Auth about the bearer token on mobile", async () => {
  const calls: Array<string | undefined> = [];
  const auth = {
    getUser: (jwt?: string) => {
      calls.push(jwt);
      return Promise.resolve("user");
    },
  };
  await getUserForRequest(auth, "tok");
  await getUserForRequest(auth, null);
  assertEquals(calls, ["tok", undefined]);
});
