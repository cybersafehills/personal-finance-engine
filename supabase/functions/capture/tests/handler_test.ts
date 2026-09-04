import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  type CaptureDeps,
  type CaptureRoute,
  handleCapture,
  handlePair,
  type HandlerResult,
  handleTest,
  type PairDeps,
  type PairingEvent,
  type TestDeps,
} from "../handler.ts";

const NOW = new Date("2026-09-03T12:00:00.000Z");
const TOKEN = "olp_ab12" + "cdef0123456789ab"; // matches PAIRING_TOKEN_PATTERN
const SECRET = "pfe_" + "abcdef0123456789ABCD"; // matches DEVICE_SECRET_PATTERN

function recorder() {
  const events: PairingEvent[] = [];
  return {
    events,
    recordEvent: (e: PairingEvent) => {
      events.push(e);
      return Promise.resolve();
    },
  };
}

Deno.test("handlePair: happy path returns device_id + capture_url, never the secret", async () => {
  const rec = recorder();
  const deps: PairDeps = {
    captureUrl: "https://api.oneledger.me/v1/capture",
    recordEvent: rec.recordEvent,
    consumePairingSession: (args) => {
      assert(/^[0-9a-f]{64}$/.test(args.tokenHash));
      assert(/^[0-9a-f]{64}$/.test(args.credentialHash));
      assertEquals(args.credentialPrefix, SECRET.slice(0, 8));
      assertEquals(args.platform, "ios");
      return Promise.resolve({
        ok: true,
        deviceCredentialId: "dc-1",
        connectorInstallationId: "ci-1",
        legacyIngestionConnectionId: "leg-1",
      });
    },
  };

  const res = await handlePair({
    op: "pair",
    pairing_token: TOKEN,
    device_secret: SECRET,
    client_version: "1.0.0",
    platform: "iOS",
    device_label: "My iPhone",
  }, deps);

  assertEquals(res.status, 200);
  assertEquals(res.body.ok, true);
  assertEquals(res.body.device_id, "dc-1");
  assertEquals(res.body.capture_url, "https://api.oneledger.me/v1/capture");
  assert(!JSON.stringify(res.body).includes(SECRET));
  assertEquals(rec.events.at(-1)?.event, "device_paired");
});

Deno.test("handlePair: DB reason codes map to HTTP status and are echoed as error", async () => {
  const cases: Array<[string, number]> = [
    ["PAIRING_EXPIRED", 410],
    ["PAIRING_ALREADY_USED", 409],
    ["PAIRING_NO_ROUTE", 400],
  ];
  for (const [code, status] of cases) {
    const rec = recorder();
    const res = await handlePair({
      op: "pair",
      pairing_token: TOKEN,
      device_secret: SECRET,
      client_version: "1.0.0",
      platform: "ios",
    }, {
      captureUrl: "x/capture",
      recordEvent: rec.recordEvent,
      consumePairingSession: () => Promise.resolve({ ok: false, code }),
    });
    assertEquals(res.status, status);
    assertEquals(res.body.error, code);
    assertEquals(rec.events.at(-1)?.reasonCode, code);
  }
});

Deno.test("handlePair: malformed token / secret rejected before the DB call", async () => {
  let called = false;
  const deps: PairDeps = {
    captureUrl: "x/capture",
    recordEvent: () => Promise.resolve(),
    consumePairingSession: () => {
      called = true;
      return Promise.resolve({ ok: false, code: "PAIRING_INVALID" });
    },
  };
  const badToken = await handlePair({
    op: "pair",
    pairing_token: "nope",
    device_secret: SECRET,
    client_version: "1.0.0",
  }, deps);
  assertEquals(badToken.status, 400);
  assertEquals(badToken.body.error, "PAIRING_INVALID");

  const badSecret = await handlePair({
    op: "pair",
    pairing_token: TOKEN,
    device_secret: "short",
    client_version: "1.0.0",
  }, deps);
  assertEquals(badSecret.status, 400);
  assertEquals(badSecret.body.error, "PAIRING_BAD_CREDENTIAL");

  assertEquals(called, false);
});

function testDeps(overrides: Partial<TestDeps> = {}) {
  const rec = recorder();
  const touched: string[] = [];
  const deps: TestDeps = {
    recordEvent: rec.recordEvent,
    authenticateDevice: () =>
      Promise.resolve({ ok: true, deviceCredentialId: "dc-9" }),
    touchCredential: (id) => {
      touched.push(id);
      return Promise.resolve();
    },
    ...overrides,
  };
  return { deps, events: rec.events, touched };
}

Deno.test("handleTest: valid credential + envelope returns {ok,test} and writes no ledger data", async () => {
  const { deps, events, touched } = testDeps();
  const res: HandlerResult = await handleTest(
    SECRET,
    {
      op: "test",
      client_version: "1.0.0",
      metadata: { test: true },
    },
    deps,
    NOW,
  );

  assertEquals(res.status, 200);
  assertEquals(res.body, { ok: true, test: true });
  assertEquals(touched, ["dc-9"]);
  assertEquals(events.at(-1)?.event, "device_test_succeeded");
});

Deno.test("handleTest: missing / bad credential is a uniform 401", async () => {
  const { deps } = testDeps({
    authenticateDevice: () =>
      Promise.resolve({ ok: false, code: "INVALID_DEVICE_CREDENTIAL" }),
  });
  const noHeader = await handleTest(
    null,
    { client_version: "1.0.0" },
    deps,
    NOW,
  );
  assertEquals(noHeader.status, 401);
  assertEquals(noHeader.body.error, "INVALID_DEVICE_CREDENTIAL");

  const unknown = await handleTest(
    SECRET,
    { client_version: "1.0.0" },
    deps,
    NOW,
  );
  assertEquals(unknown.status, 401);
  assertEquals(unknown.body.error, "INVALID_DEVICE_CREDENTIAL");
});

Deno.test("handleTest: a bad envelope is rejected and audited, credential untouched", async () => {
  const { deps, events, touched } = testDeps();
  const res = await handleTest(
    SECRET,
    {
      op: "test",
      client_version: "bogus",
    },
    deps,
    NOW,
  );
  assertEquals(res.status, 400);
  assertEquals(res.body.error, "INVALID_CAPTURE_PAYLOAD");
  assertEquals(touched.length, 0);
  assertEquals(events.at(-1)?.event, "capture_rejected");
});

// ---------------------------------------------------------------------------
// op:"capture"
// ---------------------------------------------------------------------------

const MTN_SMS =
  "TxId:29946098339*S*Your payment of 4,000 RWF to KMLVIO CENTER AND MILK ZONE SHOP 093011 was completed at 2026-08-18 11:02:56. Balance: 3,675 RWF. Fee 0 RWF.*EN#";

const ROUTE: CaptureRoute = {
  deviceCredentialId: "dc-7",
  connectorInstallationId: "ci-7",
  legacyIngestionConnectionId: "leg-7",
  financialSourceId: "fs-7",
  workspaceId: "ws-7",
  accountId: "acc-7",
};

function captureDeps(overrides: Partial<CaptureDeps> = {}) {
  const rec = recorder();
  const inserts: Array<Record<string, unknown>> = [];
  const touched: string[] = [];
  const deps: CaptureDeps = {
    recordEvent: rec.recordEvent,
    authenticateDevice: () => Promise.resolve({ ok: true, route: ROUTE }),
    recordRawEvent: (args) => {
      inserts.push(args as unknown as Record<string, unknown>);
      return Promise.resolve({ outcome: "queued", eventId: "evt-1" });
    },
    touchCredential: (deviceCredentialId) => {
      touched.push(deviceCredentialId);
      return Promise.resolve();
    },
    ...overrides,
  };
  return { deps, events: rec.events, inserts, touched };
}

Deno.test("handleCapture: valid MTN message → 202 queued + capture_accepted, canonical route passed through", async () => {
  const { deps, events, inserts, touched } = captureDeps();
  const res: HandlerResult = await handleCapture(
    SECRET,
    {
      op: "capture",
      message: MTN_SMS,
      received_at: "2026-09-03T11:59:00.000Z",
      client_version: "1.0.0",
    },
    deps,
    NOW,
  );

  assertEquals(res.status, 202);
  assertEquals(res.body, { ok: true, status: "queued", event_id: "evt-1" });
  assertEquals(events.at(-1)?.event, "capture_accepted");
  assertEquals(inserts.length, 1);
  assertEquals(inserts[0].providerKey, "mtn_momo");
  assertEquals(
    (inserts[0].route as CaptureRoute).legacyIngestionConnectionId,
    "leg-7",
  );
  assert(/^[0-9a-f]{64}$/.test(inserts[0].payloadHash as string));
  // The pairing wizard's Verify step polls last_used_at to know the
  // connection is live - a successful capture must stamp it.
  assertEquals(touched, ["dc-7"]);
});

Deno.test("handleCapture: redelivery → 200 duplicate, no capture_accepted", async () => {
  const { deps, events } = captureDeps({
    recordRawEvent: () =>
      Promise.resolve({ outcome: "duplicate", eventId: "evt-1" }),
  });
  const res = await handleCapture(
    SECRET,
    {
      op: "capture",
      message: MTN_SMS,
      client_version: "1.0.0",
    },
    deps,
    NOW,
  );
  assertEquals(res.status, 200);
  assertEquals(res.body, { ok: true, status: "duplicate" });
  assert(!events.some((e) => e.event === "capture_accepted"));
});

Deno.test("handleCapture: unknown provider → 422, no evidence write, capture_rejected, credential still touched", async () => {
  let recorded = false;
  const { deps, events, touched } = captureDeps({
    recordRawEvent: () => {
      recorded = true;
      return Promise.resolve({ outcome: "queued", eventId: "x" });
    },
  });
  const res = await handleCapture(
    SECRET,
    {
      op: "capture",
      message: "Your OneLedger code is 4821.",
      client_version: "1.0.0",
    },
    deps,
    NOW,
  );
  assertEquals(res.status, 422);
  assertEquals(res.body.error, "UNKNOWN_PROVIDER");
  assertEquals(recorded, false);
  assertEquals(events.at(-1)?.reasonCode, "UNKNOWN_PROVIDER");
  // Readiness only asks "did this device successfully reach us", not "did
  // this specific message parse" - an unrecognised message still proves
  // the pairing pipeline itself works end to end.
  assertEquals(touched, ["dc-7"]);
});

Deno.test("handleCapture: bad envelope → 400 + capture_rejected, nothing written, credential NOT touched", async () => {
  let recorded = false;
  const { deps, events, touched } = captureDeps({
    recordRawEvent: () => {
      recorded = true;
      return Promise.resolve({ outcome: "queued", eventId: "x" });
    },
  });
  const res = await handleCapture(
    SECRET,
    {
      op: "capture",
      client_version: "nope",
    },
    deps,
    NOW,
  );
  assertEquals(res.status, 400);
  assertEquals(res.body.error, "INVALID_CAPTURE_PAYLOAD");
  assertEquals(recorded, false);
  assertEquals(events.at(-1)?.event, "capture_rejected");
  // A malformed request from an authenticated device is not evidence the
  // pipeline works - only a well-formed one should mark the connection live.
  assertEquals(touched, []);
});

Deno.test("handleCapture: missing / bad / unknown credential → uniform 401, no oracle", async () => {
  const rejecting = captureDeps({
    authenticateDevice: () => Promise.resolve({ ok: false }),
  });
  for (
    const key of [null, "not-a-secret", SECRET] as Array<string | null>
  ) {
    const res = await handleCapture(
      key,
      {
        op: "capture",
        message: MTN_SMS,
        client_version: "1.0.0",
      },
      rejecting.deps,
      NOW,
    );
    assertEquals(res.status, 401);
    assertEquals(res.body.error, "INVALID_DEVICE_CREDENTIAL");
  }
});

Deno.test("handleCapture: never returns a transaction id / never claims a ledger write", async () => {
  const { deps } = captureDeps();
  const res = await handleCapture(
    SECRET,
    {
      op: "capture",
      message: MTN_SMS,
      client_version: "1.0.0",
    },
    deps,
    NOW,
  );
  const s = JSON.stringify(res.body);
  assert(!s.includes("transaction_id"));
  assert(!s.includes('"processed"'));
  assertEquals(res.body.status, "queued");
});
