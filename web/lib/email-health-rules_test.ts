import { assertEquals } from "jsr:@std/assert@1";
import { classifyEmailEnv } from "./email-health-rules.ts";

const GOOD = {
  RESEND_API_KEY: "re_abc123",
  RESEND_FROM_EMAIL: "notifications@oneledger.me",
  SITE_URL: "https://www.oneledger.me",
};

Deno.test("classifyEmailEnv: a fully-configured env has no issues", () => {
  const { issues, fromAddress, fromDomain } = classifyEmailEnv(GOOD);
  assertEquals(issues, []);
  assertEquals(fromAddress, "notifications@oneledger.me");
  assertEquals(fromDomain, "oneledger.me");
});

Deno.test("classifyEmailEnv: missing key / from / site url are all errors", () => {
  const { issues } = classifyEmailEnv({});
  const codes = issues.map((i) => i.code).sort();
  assertEquals(codes, ["missing_api_key", "missing_from", "missing_site_url"]);
  assertEquals(issues.every((i) => i.level === "error"), true);
});

Deno.test("classifyEmailEnv: resend.dev sender is a warning, not an error", () => {
  const { issues } = classifyEmailEnv({
    ...GOOD,
    RESEND_FROM_EMAIL: "onboarding@resend.dev",
  });
  assertEquals(issues.length, 1);
  assertEquals(issues[0].code, "from_sandbox");
  assertEquals(issues[0].level, "warn");
});

Deno.test("classifyEmailEnv: a non-email RESEND_FROM_EMAIL is an error", () => {
  const { issues, fromDomain } = classifyEmailEnv({
    ...GOOD,
    RESEND_FROM_EMAIL: "not-an-email",
  });
  assertEquals(fromDomain, null);
  assertEquals(issues.some((i) => i.code === "from_not_email"), true);
});

Deno.test("classifyEmailEnv: odd-shaped key warns", () => {
  const { issues } = classifyEmailEnv({ ...GOOD, RESEND_API_KEY: "sk-live-xyz" });
  assertEquals(issues.map((i) => i.code), ["api_key_shape"]);
  assertEquals(issues[0].level, "warn");
});

Deno.test("classifyEmailEnv: localhost SITE_URL only errors in production", () => {
  const dev = classifyEmailEnv({ ...GOOD, SITE_URL: "http://localhost:3417" });
  assertEquals(dev.issues, []);

  const prod = classifyEmailEnv({
    ...GOOD,
    SITE_URL: "http://localhost:3417",
    isProduction: true,
  });
  assertEquals(prod.issues.map((i) => i.code), ["site_url_localhost_in_prod"]);
  assertEquals(prod.issues[0].level, "error");
});

Deno.test("classifyEmailEnv: a relative SITE_URL warns on shape", () => {
  const { issues } = classifyEmailEnv({ ...GOOD, SITE_URL: "oneledger.me" });
  assertEquals(issues.map((i) => i.code), ["site_url_shape"]);
});
