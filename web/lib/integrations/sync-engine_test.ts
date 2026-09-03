import { assertEquals } from "jsr:@std/assert@1";
import {
  backoffSeconds,
  classifyFailure,
  MAX_SYNC_ATTEMPTS,
  nextAttemptState,
} from "./sync-engine.ts";

Deno.test("classifyFailure", () => {
  assertEquals(classifyFailure("needs_auth"), "needs_auth");
  assertEquals(classifyFailure("oauth_exchange_failed"), "needs_auth");
  assertEquals(classifyFailure("provider_not_configured"), "permanent");
  assertEquals(classifyFailure("http_4xx"), "permanent");
  assertEquals(classifyFailure("network_error"), "transient");
  assertEquals(classifyFailure(null), "transient");
});

Deno.test("backoffSeconds is exponential, capped at an hour", () => {
  assertEquals(backoffSeconds(0), 60);
  assertEquals(backoffSeconds(1), 120);
  assertEquals(backoffSeconds(3), 480);
  assertEquals(backoffSeconds(10), 3600);
});

Deno.test("nextAttemptState: transient schedules a retry", () => {
  const s = nextAttemptState(0, "network_error", 1_000_000);
  assertEquals(s.status, "queued");
  assertEquals(s.attempt, 1);
  assertEquals(s.nextAttemptAtMs, 1_000_000 + 120_000);
  assertEquals(s.markNeedsAuth, false);
});

Deno.test("nextAttemptState: exhausted attempts -> failed", () => {
  const s = nextAttemptState(MAX_SYNC_ATTEMPTS - 1, "network_error", 0);
  assertEquals(s.status, "failed");
  assertEquals(s.nextAttemptAtMs, null);
});

Deno.test("nextAttemptState: permanent -> failed immediately", () => {
  const s = nextAttemptState(0, "provider_not_configured", 0);
  assertEquals(s.status, "failed");
  assertEquals(s.nextAttemptAtMs, null);
  assertEquals(s.markNeedsAuth, false);
});

Deno.test("nextAttemptState: needs_auth -> failed + markNeedsAuth", () => {
  const s = nextAttemptState(2, "no_secret", 0);
  assertEquals(s.status, "failed");
  assertEquals(s.markNeedsAuth, true);
});
