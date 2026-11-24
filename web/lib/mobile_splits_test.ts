import { assertEquals } from "jsr:@std/assert@1";
import { parsePlanId, parseSplitOffer, parseStartSplit, splitErrorStatus } from "./mobile-splits.ts";

const KEY = "11111111-1111-4111-8111-111111111111";
const ACCT = "22222222-2222-4222-8222-222222222222";

Deno.test("an offer needs only a type and a whole, positive amount", () => {
  const r = parseSplitOffer({ paymentType: "pay_person", amountMinor: 10_000_001 });
  assertEquals(r.ok, true);
  for (const amountMinor of [0, -1, 1.5, "5", null, 1_000_000_000]) {
    assertEquals(parseSplitOffer({ paymentType: "pay_person", amountMinor }).ok, false);
  }
});

Deno.test("an offer accepts only supported payment types and networks", () => {
  assertEquals(parseSplitOffer({ paymentType: "buy_airtime", amountMinor: 5 }).ok, false);
  assertEquals(parseSplitOffer({ paymentType: "pay_person", amountMinor: 5, networkSlug: "ekash" }).ok, true);
  assertEquals(parseSplitOffer({ paymentType: "pay_person", amountMinor: 5, networkSlug: "visa" }).ok, false);
  assertEquals(parseSplitOffer({ paymentType: "pay_person", amountMinor: 5, sourceAccountId: "nope" }).ok, false);
});

Deno.test("a blank phone number is dropped, not rejected", () => {
  const r = parseSplitOffer({ paymentType: "pay_person", amountMinor: 5, recipientMsisdn: "  " });
  assertEquals(r.ok && r.value.recipientMsisdn, undefined);
});

Deno.test("start reuses the create rules and carries the network", () => {
  const body = {
    paymentType: "pay_person",
    amountMinor: 25_000_000,
    idempotencyKey: KEY,
    recipientMsisdn: "0788123456",
    sourceAccountId: ACCT,
    networkSlug: "ekash",
  };
  const r = parseStartSplit(body);
  assertEquals(r.ok && r.value.networkSlug, "ekash");
  assertEquals(parseStartSplit({ ...body, idempotencyKey: "x" }).ok, false);
  assertEquals(parseStartSplit({ ...body, recipientMsisdn: undefined }).ok, false);
  assertEquals(parseStartSplit({ ...body, networkSlug: "other" }).ok, false);
});

Deno.test("plan ids must be UUIDs", () => {
  assertEquals(parsePlanId(KEY), KEY);
  assertEquals(parsePlanId("1"), null);
});

Deno.test("service codes map to honest statuses", () => {
  assertEquals(splitErrorStatus("not_found"), 404);
  for (const c of ["waiting", "blocked", "stopped", "complete", "not_allowed"] as const) {
    assertEquals(splitErrorStatus(c), 409);
  }
  for (const c of ["invalid_account", "no_split", "could_not_prepare"] as const) {
    assertEquals(splitErrorStatus(c), 422);
  }
  assertEquals(splitErrorStatus("failed"), null);
});
