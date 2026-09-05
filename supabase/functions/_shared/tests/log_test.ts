import { assert, assertEquals } from "jsr:@std/assert@1";
import { buildLogLine, logEvent, redact } from "../log.ts";

Deno.test("buildLogLine: stable structural fields, caller fields merged", () => {
  const line = buildLogLine(
    "ingest.momo",
    "ok",
    { request_id: "req-1", correlation_id: "c-1", status: "processed" },
    new Date("2026-09-05T00:00:00.000Z"),
  );
  assertEquals(line.ts, "2026-09-05T00:00:00.000Z");
  assertEquals(line.stage, "ingest.momo");
  assertEquals(line.outcome, "ok");
  assertEquals(line.request_id, "req-1");
  assertEquals(line.status, "processed");
});

Deno.test("buildLogLine: a caller field cannot overwrite ts/stage/outcome", () => {
  const line = buildLogLine("s", "ok", {
    stage: "x",
    outcome: "error",
    ts: "x",
  });
  assertEquals(line.stage, "s");
  assertEquals(line.outcome, "ok");
  assert(line.ts !== "x");
});

Deno.test("redact: sensitive key names are blanked at any depth", () => {
  const out = redact({
    ok: "visible",
    credential_hash: "abc",
    headers: { authorization: "Bearer xyz", "x-ingest-key": "k" },
    raw_message: "You have received RWF 5,000",
    amount_minor: 5000,
  }) as Record<string, unknown>;
  assertEquals(out.ok, "visible");
  assertEquals(out.credential_hash, "[redacted]");
  assertEquals(
    (out.headers as Record<string, unknown>).authorization,
    "[redacted]",
  );
  assertEquals(out.raw_message, "[redacted]");
  assertEquals(out.amount_minor, 5000);
});

Deno.test("redact: secret-shaped values are blanked under innocent keys", () => {
  const out = redact({
    note: "olp_3f9c2a7b1e",
    other: "pfe_abcdef",
    fine: "processed",
  }) as Record<string, unknown>;
  assertEquals(out.note, "[redacted]");
  assertEquals(out.other, "[redacted]");
  assertEquals(out.fine, "processed");
});

Deno.test("logEvent: error goes to stderr, everything else to stdout", () => {
  const out: string[] = [];
  const err: string[] = [];
  const oL = console.log;
  const oE = console.error;
  console.log = (m?: unknown) => void out.push(String(m));
  console.error = (m?: unknown) => void err.push(String(m));
  try {
    logEvent("cron.deliver-reports", "ok", { considered: 2 });
    logEvent("cron.deliver-reports", "error", { error: "nope" });
  } finally {
    console.log = oL;
    console.error = oE;
  }
  assertEquals(out.length, 1);
  assertEquals(err.length, 1);
  assertEquals(JSON.parse(out[0]).outcome, "ok");
  assertEquals(JSON.parse(err[0]).outcome, "error");
});
