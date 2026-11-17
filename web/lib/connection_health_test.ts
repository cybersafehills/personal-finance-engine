import { assertEquals } from "jsr:@std/assert@1";
import { connectionHealth, QUIET_AFTER_HOURS } from "./connection-health.ts";

const NOW = Date.parse("2026-11-17T12:00:00Z");
const ago = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString();

Deno.test("revoked and paused win over message history", () => {
  assertEquals(
    connectionHealth({ status: "revoked", last_used_at: ago(1) }, NOW).state,
    "removed",
  );
  assertEquals(
    connectionHealth({ status: "paused", last_used_at: ago(1) }, NOW).state,
    "paused",
  );
});

Deno.test("never used ⇒ waiting; bad timestamp ⇒ waiting", () => {
  assertEquals(
    connectionHealth({ status: "active", last_used_at: null }, NOW).state,
    "waiting",
  );
  assertEquals(
    connectionHealth({ status: "active", last_used_at: "nope" }, NOW).state,
    "waiting",
  );
});

Deno.test("recent message ⇒ working", () => {
  const h = connectionHealth({ status: "active", last_used_at: ago(5) }, NOW);
  assertEquals(h, { state: "working", quietDays: null });
});

Deno.test("quiet threshold is inclusive and reports whole days", () => {
  assertEquals(
    connectionHealth({ status: "active", last_used_at: ago(QUIET_AFTER_HOURS - 1) }, NOW)
      .state,
    "working",
  );
  assertEquals(
    connectionHealth({ status: "active", last_used_at: ago(QUIET_AFTER_HOURS) }, NOW),
    { state: "quiet", quietDays: 2 },
  );
  assertEquals(
    connectionHealth({ status: "active", last_used_at: ago(24 * 4 + 3) }, NOW)
      .quietDays,
    4,
  );
});
