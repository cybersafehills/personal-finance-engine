import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  createRateLimiter,
  extractPairingErrorCode,
  mapPairingReasonToHttp,
  sha256Hex,
  validateCaptureEnvelope,
} from "../pairing.ts";

const NOW = new Date("2026-09-03T12:00:00.000Z");

Deno.test("mapPairingReasonToHttp maps every code, defaulting to 400", () => {
  assertEquals(mapPairingReasonToHttp("PAIRING_EXPIRED"), 410);
  assertEquals(mapPairingReasonToHttp("PAIRING_ALREADY_USED"), 409);
  assertEquals(mapPairingReasonToHttp("PAIRING_INVALID"), 400);
  assertEquals(mapPairingReasonToHttp("PAIRING_BAD_CREDENTIAL"), 400);
  assertEquals(mapPairingReasonToHttp("PAIRING_NO_ROUTE"), 400);
  assertEquals(mapPairingReasonToHttp("something_else"), 400);
});

Deno.test("extractPairingErrorCode recovers the bare code from a PostgREST message", () => {
  assertEquals(extractPairingErrorCode("PAIRING_EXPIRED"), "PAIRING_EXPIRED");
  assertEquals(
    extractPairingErrorCode('new row violates ... "PAIRING_ALREADY_USED"'),
    "PAIRING_ALREADY_USED",
  );
  assertEquals(extractPairingErrorCode("boom"), null);
  assertEquals(extractPairingErrorCode(null), null);
});

Deno.test("sha256Hex returns a lowercase 64-hex digest", async () => {
  const digest = await sha256Hex("olp_ab12" + "x".repeat(20));
  assert(/^[0-9a-f]{64}$/.test(digest));
});

Deno.test("validateCaptureEnvelope accepts a well-formed message envelope", () => {
  const result = validateCaptureEnvelope(
    {
      op: "capture",
      message: "You have received RWF 5,000 from JEAN.",
      received_at: "2026-09-03T11:59:00.000Z",
      client_version: "1.0.0",
      metadata: { source: "messages" },
    },
    NOW,
    { requireMessage: true },
  );
  assert(result.ok);
  if (result.ok) {
    assertEquals(result.value.client_version, "1.0.0");
    assertEquals(result.value.test, false);
  }
});

Deno.test("validateCaptureEnvelope defaults received_at to now and flags test metadata", () => {
  const result = validateCaptureEnvelope(
    {
      client_version: "2.3.4",
      metadata: { test: true },
    },
    NOW,
    { requireMessage: false },
  );
  assert(result.ok);
  if (result.ok) {
    assertEquals(result.value.received_at, NOW.toISOString());
    assertEquals(result.value.test, true);
    assertEquals(result.value.message, null);
  }
});

Deno.test("validateCaptureEnvelope rejects bad shapes", () => {
  const cases: Array<[unknown, string]> = [
    [null, "not_an_object"],
    [{ client_version: "1.0.0", surprise: 1 }, "unknown_field"],
    [{ client_version: "1.0", message: "hi" }, "client_version"],
    [{ client_version: "1.0.0", message: "" }, "message_length"],
    [{ client_version: "1.0.0", message: "x".repeat(2001) }, "message_length"],
    [{ client_version: "1.0.0" }, "message_required"],
    [
      {
        client_version: "1.0.0",
        received_at: "2020-01-01T00:00:00Z",
        message: "hi",
      },
      "received_at_range",
    ],
    [
      { client_version: "1.0.0", received_at: "not-a-date", message: "hi" },
      "received_at_format",
    ],
    [
      {
        client_version: "1.0.0",
        message: "hi",
        metadata: { blob: "y".repeat(2000) },
      },
      "metadata_size",
    ],
  ];
  for (const [input, reason] of cases) {
    const result = validateCaptureEnvelope(input, NOW, {
      requireMessage: true,
    });
    assert(!result.ok, `expected reject for ${reason}`);
    if (!result.ok) assertEquals(result.reason, reason);
  }
});

Deno.test("createRateLimiter enforces a fixed window", () => {
  const limiter = createRateLimiter({ windowMs: 1000, max: 2 });
  assertEquals(limiter.check("k", 0).ok, true);
  assertEquals(limiter.check("k", 100).ok, true);
  const blocked = limiter.check("k", 200);
  assertEquals(blocked.ok, false);
  if (!blocked.ok) assert(blocked.retryAfterSec >= 1);
  // window rolls over
  assertEquals(limiter.check("k", 1200).ok, true);
  // independent key unaffected
  assertEquals(limiter.check("other", 200).ok, true);
});
