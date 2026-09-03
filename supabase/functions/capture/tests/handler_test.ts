import { assert, assertEquals } from "jsr:@std/assert@1";
import {
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
