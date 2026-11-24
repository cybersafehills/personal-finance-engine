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

import { parseSplitPrefs, toMobilePlan } from "./mobile-splits.ts";

Deno.test("preferences: fee-saving is opt-in, so a missing flag is refused, never turned on", () => {
  assertEquals(parseSplitPrefs({ threshold: "balanced" }).ok, false);
  assertEquals(parseSplitPrefs({ feeSavingEnabled: "yes", threshold: "balanced" }).ok, false);
  assertEquals(parseSplitPrefs({ feeSavingEnabled: true, threshold: "huge" }).ok, false);
  const r = parseSplitPrefs({ feeSavingEnabled: false, threshold: "bigger" });
  assertEquals(r.ok && r.value, { feeSavingEnabled: false, threshold: "bigger" });
});

const plan = {
  id: KEY,
  kind: "capacity" as const,
  network_slug: "ekash",
  currency: "RWF",
  total_amount_minor: "25000000",
  planned_parts: ["8333334", "8333333", "8333333"],
  single_fee_minor: null,
  planned_fee_minor: "60",
  fee_basis: "verified_tariff" as const,
  stopped_at: null,
};

Deno.test("a plan waits for the previous part before the next can be prepared", () => {
  const waiting = toMobilePlan(plan, [{ id: "a", split_index: 1, amount_minor: "8333334", state: "awaiting_verification" }]);
  assertEquals(waiting.next, { status: "waiting", index: 2, amountMinor: "8333333" });
  const ready = toMobilePlan(plan, [{ id: "a", split_index: 1, amount_minor: "8333334", state: "successful" }]);
  assertEquals(ready.next, { status: "ready", index: 2, amountMinor: "8333333" });
  assertEquals(ready.remainingMinor, "16666666");
  assertEquals(ready.parts, [{ index: 1, intentId: "a", amountMinor: "8333334", state: "successful" }]);
});

Deno.test("a stopped plan offers nothing, and cancelled drafts are not listed", () => {
  const stopped = toMobilePlan({ ...plan, stopped_at: "2026-11-24T10:00:00Z" }, [
    { id: "a", split_index: 1, amount_minor: "8333334", state: "successful" },
    { id: "b", split_index: 2, amount_minor: "8333333", state: "cancelled" },
  ]);
  assertEquals(stopped.next, { status: "stopped" });
  assertEquals(stopped.stopped, true);
  assertEquals(stopped.parts.length, 1);
  // A capacity plan can never be sent as one transfer.
  assertEquals(stopped.canSendRemaining, false);
});
