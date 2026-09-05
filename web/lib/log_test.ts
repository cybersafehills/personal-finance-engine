import { assert, assertEquals } from "jsr:@std/assert@1";
import { buildLogLine, redact, withLoggedRun } from "./log.ts";

Deno.test("buildLogLine: stable structural fields, caller fields merged", () => {
  const line = buildLogLine(
    "cron.generate-reports",
    "ok",
    { request_id: "req-1", duration_ms: 12, considered: 3 },
    new Date("2026-09-05T00:00:00.000Z"),
  );
  assertEquals(line.ts, "2026-09-05T00:00:00.000Z");
  assertEquals(line.stage, "cron.generate-reports");
  assertEquals(line.outcome, "ok");
  assertEquals(line.request_id, "req-1");
  assertEquals(line.considered, 3);
});

Deno.test("buildLogLine: structural keys cannot be overridden by a caller field", () => {
  const line = buildLogLine("s", "ok", {
    stage: "spoofed",
    outcome: "error",
    ts: "spoofed",
  });
  assertEquals(line.stage, "s");
  assertEquals(line.outcome, "ok");
  assert(line.ts !== "spoofed");
});

Deno.test("redact: a sensitive key name blanks its value at any depth", () => {
  const out = redact({
    ok: "visible",
    api_key: "abcd1234",
    nested: { deviceSecret: "pfe_zzz", authToken: "x" },
    "x-notification-cron-secret": "shhh",
    raw_message: "You have received RWF 5,000 from JOHN DOE",
  }) as Record<string, unknown>;
  assertEquals(out.ok, "visible");
  assertEquals(out.api_key, "[redacted]");
  assertEquals(
    (out.nested as Record<string, unknown>).deviceSecret,
    "[redacted]",
  );
  assertEquals((out.nested as Record<string, unknown>).authToken, "[redacted]");
  assertEquals(out["x-notification-cron-secret"], "[redacted]");
  assertEquals(out.raw_message, "[redacted]");
});

Deno.test("redact: a secret-shaped value is blanked even under an innocent key", () => {
  const out = redact({
    note: "olp_3f9c2a7b1e",
    jwt: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig",
    hex: "a".repeat(64),
    amount_minor: 5000,
  }) as Record<string, unknown>;
  assertEquals(out.note, "[redacted]");
  assertEquals(out.jwt, "[redacted]");
  assertEquals(out.hex, "[redacted]");
  assertEquals(out.amount_minor, 5000);
});

Deno.test("withLoggedRun: emits start + ok, returns the value, and threads one correlation id", async () => {
  const lines: string[] = [];
  const origLog = console.log;
  console.log = (msg?: unknown) => void lines.push(String(msg));
  try {
    const result = await withLoggedRun("cron.x", { request_id: "r" }, () => {
      return Promise.resolve(42);
    });
    assertEquals(result, 42);
  } finally {
    console.log = origLog;
  }
  assertEquals(lines.length, 2);
  const start = JSON.parse(lines[0]);
  const ok = JSON.parse(lines[1]);
  assertEquals(start.outcome, "start");
  assertEquals(ok.outcome, "ok");
  assertEquals(start.correlation_id, ok.correlation_id);
  assert(typeof ok.duration_ms === "number");
});

Deno.test("withLoggedRun: emits an error line and re-throws", async () => {
  const lines: string[] = [];
  const origErr = console.error;
  const origLog = console.log;
  console.error = (msg?: unknown) => void lines.push(String(msg));
  console.log = () => {};
  let threw = false;
  try {
    await withLoggedRun("cron.y", {}, () => {
      throw new Error("boom");
    });
  } catch (e) {
    threw = true;
    assertEquals((e as Error).message, "boom");
  } finally {
    console.error = origErr;
    console.log = origLog;
  }
  assert(threw);
  const err = JSON.parse(lines.at(-1) as string);
  assertEquals(err.outcome, "error");
  assertEquals(err.error, "boom");
});
