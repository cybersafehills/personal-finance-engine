import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  buildPublicUrl,
  canTransition,
  type CreateInput,
  effectiveStatus,
  generateToken,
  hashToken,
  isValidToken,
  parsePublicUrl,
  payerFacingLabel,
  validateCreateInput,
} from "./payment-request.ts";

const NOW = new Date("2026-11-15T12:00:00Z");
const ok = (o: Partial<CreateInput> = {}): CreateInput => ({
  amountMinor: 5000n,
  currency: "RWF",
  destinationType: "momo_phone",
  destinationValue: "0793000439",
  recipientDisplay: "Samuel N",
  reference: "Rent Nov",
  expiresAt: new Date(NOW.getTime() + 7 * 86_400_000),
  ...o,
});

Deno.test("token: 256-bit hex, unique, hashed with SHA-256 (known vector)", async () => {
  const a = generateToken(), b = generateToken();
  assertEquals(isValidToken(a), true);
  assertEquals(a.length, 64);
  assertEquals(a === b, false);
  // sha256("00"*32 hex string) is deterministic; check against an independent computation
  const t = "0".repeat(64);
  const expected = Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)),
    ),
    (x) => x.toString(16).padStart(2, "0"),
  ).join("");
  assertEquals(await hashToken(t), expected);
  assertEquals((await hashToken(t)).length, 64);
  await assertRejects(() => hashToken("not-a-token"));
});

const T = "ab".repeat(32);
Deno.test("public URL round-trips and is the only accepted form", () => {
  const url = buildPublicUrl("https://app.oneledger.me", T);
  assertEquals(url, `https://app.oneledger.me/r/${T}`);
  assertEquals(parsePublicUrl(url, "https://app.oneledger.me"), T);
});

Deno.test("QR/link tampering is rejected", () => {
  const o = "https://app.oneledger.me";
  const bad = [
    `http://app.oneledger.me/r/${T}`, // downgrade
    `https://app.oneledger.me.evil.com/r/${T}`, // look-alike host
    `https://evil.com/r/${T}`,
    `https://app.oneledger.me@evil.com/r/${T}`, // userinfo trick
    `https://user:pw@app.oneledger.me/r/${T}`,
    `https://app.oneledger.me:8443/r/${T}`, // other port
    `https://app.oneledger.me/r/${T}?next=https://evil.com`, // query / open redirect
    `https://app.oneledger.me/r/${T}#x`,
    `https://app.oneledger.me/r/${T}/extra`,
    `https://app.oneledger.me/r/${T.toUpperCase()}`, // wrong case
    `https://app.oneledger.me/r/${T.slice(1)}`, // short
    `https://app.oneledger.me//r/${T}`,
    `javascript:alert(1)`,
    "",
    "not a url",
  ];
  for (const u of bad) assertEquals(parsePublicUrl(u, o), null, u);
  // origin itself must be a bare https origin
  assertEquals(parsePublicUrl(`https://a.me/r/${T}`, "http://a.me"), null);
  assertEquals(
    parsePublicUrl(`https://a.me/r/${T}`, "https://a.me/path"),
    null,
  );
});

Deno.test("buildPublicUrl refuses unsafe inputs", () => {
  for (
    const o of ["http://a.me", "https://a.me/x", "https://u:p@a.me", "a.me"]
  ) {
    let threw = false;
    try {
      buildPublicUrl(o, T);
    } catch {
      threw = true;
    }
    assertEquals(threw, true, o);
  }
  let threw = false;
  try {
    buildPublicUrl("https://a.me", "short");
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});

Deno.test("validateCreateInput accepts a good request and flags each bad field", () => {
  assertEquals(validateCreateInput(ok(), NOW), []);
  assertEquals(
    validateCreateInput(
      ok({ destinationType: "merchant_code", destinationValue: "093011" }),
      NOW,
    ),
    [],
  );
  assertEquals(validateCreateInput(ok({ amountMinor: 0n }), NOW), [
    "invalid_amount",
  ]);
  assertEquals(
    validateCreateInput(ok({ amountMinor: 1_000_000_000_001n }), NOW),
    ["invalid_amount"],
  );
  assertEquals(validateCreateInput(ok({ currency: "GBP" }), NOW), [
    "invalid_currency",
  ]);
  assertEquals(validateCreateInput(ok({ destinationValue: "12345" }), NOW), [
    "invalid_destination",
  ]);
  assertEquals(
    validateCreateInput(
      ok({ destinationType: "merchant_code", destinationValue: "12" }),
      NOW,
    ),
    ["invalid_destination"],
  );
  assertEquals(validateCreateInput(ok({ recipientDisplay: "  " }), NOW), [
    "invalid_recipient",
  ]);
  assertEquals(validateCreateInput(ok({ recipientDisplay: "a\u0007b" }), NOW), [
    "invalid_recipient",
  ]);
  assertEquals(validateCreateInput(ok({ reference: "x".repeat(65) }), NOW), [
    "invalid_reference",
  ]);
  assertEquals(
    validateCreateInput(
      ok({ expiresAt: new Date(NOW.getTime() + 30_000) }),
      NOW,
    ),
    ["invalid_expiry"],
  );
  assertEquals(
    validateCreateInput(
      ok({ expiresAt: new Date(NOW.getTime() + 91 * 86_400_000) }),
      NOW,
    ),
    ["invalid_expiry"],
  );
  assertEquals(validateCreateInput(ok({ expiresAt: new Date("nope") }), NOW), [
    "invalid_expiry",
  ]);
});

Deno.test("expiry is derived; only open requests can transition; paid-by-owner needs unexpired", () => {
  const future = new Date(NOW.getTime() + 1000),
    past = new Date(NOW.getTime() - 1000);
  assertEquals(effectiveStatus("open", past, NOW), "expired");
  assertEquals(effectiveStatus("open", future, NOW), "open");
  assertEquals(effectiveStatus("matched", past, NOW), "matched");
  for (const s of ["cancelled", "marked_paid_by_owner", "matched"] as const) {
    for (
      const a of ["cancel", "mark_paid_by_owner", "match_transaction"] as const
    ) {
      assertEquals(canTransition(s, future, NOW, a), false, `${s}/${a}`);
    }
  }
  assertEquals(canTransition("open", future, NOW, "cancel"), true);
  assertEquals(canTransition("open", past, NOW, "cancel"), true);
  assertEquals(canTransition("open", past, NOW, "mark_paid_by_owner"), false);
  assertEquals(canTransition("open", past, NOW, "match_transaction"), true);
});

Deno.test("payer-facing wording never claims verification or payment for open/expired", () => {
  assertEquals(payerFacingLabel("open").includes("not verified"), true);
  for (const s of ["open", "expired", "cancelled"] as const) {
    assertEquals(/\bpaid\b/i.test(payerFacingLabel(s)), false, s);
  }
  assertEquals(
    payerFacingLabel("marked_paid_by_owner").startsWith("The requester says"),
    true,
  );
});
