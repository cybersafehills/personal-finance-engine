import { assert, assertEquals } from "jsr:@std/assert@1";
import { parseScan } from "./pipeline.ts";
import type { ScanResolvers, UssdDirectoryMatch } from "./pipeline.ts";

const NOW = Date.parse("2026-08-28T12:00:00Z");

// A stub directory: a literal *182# code and a parameterised send-money
// code, one verified, one merely published.
const directory: Record<string, UssdDirectoryMatch> = {
  "*182#": {
    slug: "mtn-momo-menu",
    template: "*182#",
    providerLabel: "MTN MoMo",
    verified: false,
  },
};
const resolvers: ScanResolvers = {
  now: () => NOW,
  providerAllowlist: [{ provider: "MTN MoMo", hosts: ["pay.mtn.co.rw"] }],
  matchUssd: (dial) => {
    if (directory[dial]) return directory[dial];
    if (/^\*182\*8\*1\*\d+\*\d+#$/.test(dial)) {
      return {
        slug: "mtn-momo-send",
        template: "*182*8*1*{merchant}*{amount}#",
        providerLabel: "MTN MoMo",
        verified: true,
      };
    }
    return null;
  },
};

function oneledger(extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    v: 1,
    type: "merchant_payment",
    provider: "mtn_momo",
    merchant_id: "KGL-COFFEE-01",
    currency: "RWF",
    ...extra,
  });
}

Deno.test("pipeline: a directory-matched literal USSD -> verified_ussd model", async () => {
  const r = await parseScan("tel:*182%23", resolvers);
  assert(r.ok);
  assertEquals(r.model.class, "verified_ussd");
  assertEquals(r.model.route.kind, "ussd");
  assertEquals(r.model.providerVerified, false);
  assert(r.model.warnings.includes("ussd_not_officially_verified"));
});

Deno.test("pipeline: a parameterised USSD match surfaces its params + amount_missing", async () => {
  const r = await parseScan("*182*8*1*123456*5000#", resolvers);
  assert(r.ok);
  const route = r.model.route;
  assertEquals(route.kind, "ussd");
  if (route.kind === "ussd") {
    assertEquals(route.params.map((p) => p.key).sort(), ["amount", "merchant"]);
  }
  assertEquals(r.model.amountEditable, true);
});

Deno.test("pipeline: a USSD not in the directory is unknown_ussd", async () => {
  const r = await parseScan("*999*1#", resolvers);
  assert(!r.ok);
  assertEquals(r.reason, "unknown_ussd");
});

Deno.test("pipeline: no USSD resolver -> needs_connection (never guessed)", async () => {
  const r = await parseScan("*182#", { now: () => NOW });
  assert(!r.ok);
  assertEquals(r.reason, "needs_connection");
});

Deno.test("pipeline: a valid OneLedger payload with amount -> model", async () => {
  const r = await parseScan(oneledger({ amount_minor: 5000, reference: "INV-42" }), resolvers);
  assert(r.ok);
  assertEquals(r.model.class, "oneledger_payment");
  assertEquals(r.model.amount, { minor: 5000, currency: "RWF" });
  assertEquals(r.model.reference, "INV-42");
  assert(r.model.warnings.includes("merchant_unverified"));
  assertEquals(r.model.providerVerified, false);
});

Deno.test("pipeline: an expired OneLedger payload is rejected", async () => {
  const r = await parseScan(oneledger({ expires_at: "2020-01-01T00:00:00Z" }), resolvers);
  assert(!r.ok);
  assertEquals(r.reason, "oneledger_expired");
});

Deno.test("pipeline: executable schemes are suspicious, never parsed", async () => {
  const r = await parseScan("javascript:alert(1)", resolvers);
  assert(!r.ok);
  assertEquals(r.class, "suspicious");
  assertEquals(r.reason, "unsafe_scheme");
});

Deno.test("pipeline: a non-allowlisted https link is unsupported/provider_not_allowlisted", async () => {
  const r = await parseScan("https://not-a-provider.example/pay", resolvers);
  assert(!r.ok);
  assertEquals(r.class, "unsupported");
  assertEquals(r.reason, "provider_not_allowlisted");
});

Deno.test("pipeline: a lookalike host is escalated to suspicious", async () => {
  const r = await parseScan("https://mtn.co.rw/pay", {
    ...resolvers,
    providerAllowlist: [{ provider: "MTN MoMo", hosts: ["pay.mtn.co.rw"] }],
  });
  assert(!r.ok);
  assertEquals(r.class, "suspicious");
  assertEquals(r.reason, "lookalike_host");
});

Deno.test("pipeline: an allowlisted https link -> provider_link model", async () => {
  const r = await parseScan("https://pay.mtn.co.rw/momo/x", resolvers);
  assert(r.ok);
  assertEquals(r.model.class, "provider_link");
  assertEquals(r.model.providerVerified, true);
});

Deno.test("pipeline: a genuine EMV payload is recognised but unsupported", async () => {
  // 000201 + a currency tag + 6304 + <crc over everything up to 6304>.
  // crc value is validated by emv_test.ts; here we only need "recognised".
  const body = "000201" + "5303646";
  const { crc16ccitt } = await import("./emv.ts");
  const emv = body + "6304" + crc16ccitt(body + "6304");
  const r = await parseScan(emv, resolvers);
  assert(!r.ok);
  assertEquals(r.reason, "emv_unsupported");
});

Deno.test("pipeline: an oversized blob is rejected at normalize", async () => {
  const r = await parseScan("x".repeat(9000), resolvers);
  assert(!r.ok);
  assertEquals(r.reason, "too_long");
});
