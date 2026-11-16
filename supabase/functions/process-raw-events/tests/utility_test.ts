import { assertEquals, assertNotMatch } from "jsr:@std/assert@1";
import { open, parseKeyring } from "../../_shared/sensitive-crypto.ts";
import {
  kwhToMilli,
  meterLast4,
  redactUtilityToken,
} from "../../ingest-momo/utility-receipt.ts";
import { processUtilityReceipt, type UtilityDeps } from "../utility.ts";

// SYNTHETIC messages (see ingest-momo/tests/utility_receipt_test.ts).
const EN = `Cashpower Token:
0000-1111-2222-3333-4444
Purchased 11.90 KWh for 5,000 RWF,
Meter# 10000000001
TxID: 20000000000001`;

const K = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)));

function fake(
  result: { ok: true; created: boolean; status: string } | { ok: false } = {
    ok: true,
    created: true,
    status: "unmatched",
  },
) {
  const stored: Record<string, unknown>[] = [];
  const finalized: { parseStatus: string; rawMessage: string | null }[] = [];
  const deps: UtilityDeps = {
    storeReceipt: (a) => {
      stored.push(a);
      return Promise.resolve(result);
    },
    finalize: (p) => {
      finalized.push(p);
      return Promise.resolve();
    },
  };
  return { stored, finalized, deps };
}

const base = {
  rawMessage: EN,
  deviceReceivedAt: "2026-08-10T12:00:00.000Z",
  eventReceivedAt: "2026-08-10T12:00:05.000Z",
  workspaceId: "ws-1",
  attempts: 0,
};

Deno.test("helpers: kWh to integer thousandths, meter last 4, token redaction", () => {
  assertEquals(kwhToMilli("11.9"), 11900);
  assertEquals(kwhToMilli("2.4"), 2400);
  assertEquals(kwhToMilli("23.805"), 23805);
  assertEquals(kwhToMilli("7"), 7000);
  for (const bad of ["", "0", "0.0", "1.2345", "abc", "-1", "1e3"]) {
    assertEquals(kwhToMilli(bad), null, bad);
  }
  assertEquals(meterLast4("10000000001"), "0001");
  assertEquals(meterLast4("0215000718977"), "8977");
  assertEquals(meterLast4("123"), null);
  assertEquals(meterLast4(null), null);
  assertEquals(redactUtilityToken(EN).includes("0000-1111"), false);
  assertEquals(redactUtilityToken(EN).includes("[token removed]"), true);
  assertEquals(
    redactUtilityToken("no token here 5,000 RWF"),
    "no token here 5,000 RWF",
  );
});

Deno.test("with capture on and a key: stores ciphertext only, last-4 meter, no plaintext anywhere, raw redacted", async () => {
  const ring = await parseKeyring(`k1:${K}`);
  const f = fake();
  const out = await processUtilityReceipt({
    ...base,
    captureEnabled: true,
    ring,
    deps: f.deps,
  });
  assertEquals(out, "processed");
  const row = f.stored[0];
  assertEquals([row.amountRwf, row.kwhMilli, row.meterLast4, row.format], [
    5000,
    11900,
    "0001",
    "cashpower_en",
  ]);
  assertEquals(row.receiptAt, "2026-08-10T12:00:00.000Z");
  assertEquals(/^[0-9a-f]{64}$/.test(row.vendorRefHash as string), true);
  const dump = JSON.stringify(row);
  assertNotMatch(dump, /0000-?1111|00001111222233334444/);
  assertNotMatch(dump, /10000000001/); // the full meter is never stored
  // it decrypts with the id-bound AAD, and only with it
  const plain = await open(
    {
      keyId: row.tokenKeyId as string,
      nonce: row.tokenNonce as string,
      ciphertext: row.tokenCiphertext as string,
    },
    ring!,
    `${row.id}:utility_receipt`,
  );
  assertEquals(plain, "00001111222233334444");
  assertEquals(f.finalized[0].parseStatus, "normalized");
  assertEquals(f.finalized[0].rawMessage?.includes("0000-1111"), false);
});

Deno.test("capture off or no key: the receipt is kept but the token is NOT (never plaintext)", async () => {
  const ring = await parseKeyring(`k1:${K}`);
  for (
    const cfg of [{ captureEnabled: false, ring }, {
      captureEnabled: true,
      ring: null,
    }, { captureEnabled: false, ring: null }]
  ) {
    const f = fake();
    assertEquals(
      await processUtilityReceipt({ ...base, ...cfg, deps: f.deps }),
      "processed",
    );
    const row = f.stored[0];
    assertEquals([row.tokenKeyId, row.tokenNonce, row.tokenCiphertext], [
      null,
      null,
      null,
    ]);
    assertNotMatch(JSON.stringify(row), /0000-?1111/);
  }
});

Deno.test("a redelivered receipt is superseded, not duplicated", async () => {
  const f = fake({ ok: true, created: false, status: "matched" });
  assertEquals(
    await processUtilityReceipt({
      ...base,
      captureEnabled: false,
      ring: null,
      deps: f.deps,
    }),
    "superseded",
  );
  assertEquals(f.finalized[0].parseStatus, "superseded");
});

Deno.test("unparseable or incomplete receipt: nothing stored, evidence redacted and rejected", async () => {
  const f = fake();
  const out = await processUtilityReceipt({
    ...base,
    rawMessage: EN.replace(
      "Purchased 11.90 KWh for 5,000 RWF,",
      "Purchased for 5,000 RWF,",
    ),
    captureEnabled: true,
    ring: await parseKeyring(`k1:${K}`),
    deps: f.deps,
  });
  assertEquals(out, "failed");
  assertEquals(f.stored.length, 0);
  assertEquals(f.finalized[0].parseStatus, "rejected");
  assertEquals(f.finalized[0].rawMessage?.includes("0000-1111"), false);
});

Deno.test("a storage failure is retried (bounded) and writes/finalises nothing", async () => {
  const f = fake({ ok: false });
  assertEquals(
    await processUtilityReceipt({
      ...base,
      captureEnabled: false,
      ring: null,
      deps: f.deps,
    }),
    "retried",
  );
  assertEquals(
    await processUtilityReceipt({
      ...base,
      attempts: 4,
      captureEnabled: false,
      ring: null,
      deps: f.deps,
    }),
    "failed",
  );
  assertEquals(f.finalized.length, 0);
});

Deno.test("a missing or invalid device time falls back to the event time", async () => {
  const f = fake();
  await processUtilityReceipt({
    ...base,
    deviceReceivedAt: null,
    captureEnabled: false,
    ring: null,
    deps: f.deps,
  });
  await processUtilityReceipt({
    ...base,
    deviceReceivedAt: "not a date",
    captureEnabled: false,
    ring: null,
    deps: f.deps,
  });
  assertEquals(f.stored.map((r) => r.receiptAt), [
    "2026-08-10T12:00:05.000Z",
    "2026-08-10T12:00:05.000Z",
  ]);
});
