import { assertEquals } from "jsr:@std/assert@1";
import {
  authorizeProcessorRequest,
  decideParseStatus,
  secretsEqual,
} from "../lib.ts";
import type { PipelineResult } from "../../_shared/ingestion-pipeline.ts";

const SECRET = "s".repeat(40);

function req(method: string, header?: string): Request {
  const h = new Headers();
  if (header !== undefined) h.set("x-processor-secret", header);
  return new Request("https://x/process-raw-events", { method, headers: h });
}

Deno.test("secretsEqual: constant-time-ish exact match only", () => {
  assertEquals(secretsEqual("abc", "abc"), true);
  assertEquals(secretsEqual("abc", "abd"), false);
  assertEquals(secretsEqual("ab", "abc"), false);
  assertEquals(secretsEqual(null, "abc"), false);
});

Deno.test("authorizeProcessorRequest: both gates enforced", () => {
  const on = (
    k: string,
  ):
    | string
    | undefined => ({
      DEVICE_PAIRING_V2: "enabled",
      RAW_EVENTS_PROCESSOR_SECRET: SECRET,
    }[k]);

  assertEquals(
    authorizeProcessorRequest(req("GET", SECRET), on),
    "method_not_allowed",
  );
  assertEquals(
    authorizeProcessorRequest(
      req("POST", SECRET),
      (k) => ({ RAW_EVENTS_PROCESSOR_SECRET: SECRET }[k]),
    ),
    "not_found", // DEVICE_PAIRING_V2 unset
  );
  assertEquals(
    authorizeProcessorRequest(
      req("POST", SECRET),
      (k) => ({ DEVICE_PAIRING_V2: "enabled" }[k]),
    ),
    "secret_not_configured",
  );
  assertEquals(
    authorizeProcessorRequest(req("POST", "wrong"), on),
    "unauthorized",
  );
  assertEquals(authorizeProcessorRequest(req("POST", SECRET), on), "ok");
  assertEquals(authorizeProcessorRequest(req("POST"), on), "unauthorized");
});

Deno.test("decideParseStatus: maps every pipeline result", () => {
  const cases: Array<[PipelineResult, string, string]> = [
    [{ status: "processed", transactionId: "t" }, "normalized", "processed"],
    [
      { status: "duplicate_transaction", transactionId: "t" },
      "superseded",
      "superseded",
    ],
    [{ status: "needs_review" }, "failed", "failed"],
    [{ status: "account_unavailable" }, "failed", "failed"],
    [{ status: "accounting_failed" }, "failed", "failed"],
  ];
  for (const [result, parseStatus, bucket] of cases) {
    const d = decideParseStatus(result, 0);
    assertEquals(d.parseStatus, parseStatus);
    assertEquals(d.bucket, bucket);
  }
});

Deno.test("decideParseStatus: db_error retries until the attempt cap, then fails", () => {
  const err: PipelineResult = { status: "db_error" };
  assertEquals(decideParseStatus(err, 0), {
    parseStatus: "pending",
    bucket: "retried",
  });
  assertEquals(decideParseStatus(err, 3), {
    parseStatus: "pending",
    bucket: "retried",
  });
  assertEquals(decideParseStatus(err, 4), {
    parseStatus: "failed",
    bucket: "failed",
  });
  assertEquals(decideParseStatus(err, 9), {
    parseStatus: "failed",
    bucket: "failed",
  });
});
