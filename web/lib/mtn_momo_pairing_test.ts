import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  buildMtnMomoPairingIdentity,
  normalizeRwandaMtnMsisdn,
} from "./mtn-momo-pairing.ts";

Deno.test("MTN pairing normalizes Rwanda numbers and emits hashes only", async () => {
  assertEquals(normalizeRwandaMtnMsisdn("0788 000 001"), "250788000001");
  const identity = await buildMtnMomoPairingIdentity("+250 788 000 001");

  assertEquals(identity.sourceRefHash.length, 64);
  assertEquals(identity.accountRefHash.length, 64);
  assertEquals(identity.maskedIdentifier, "MTN MoMo •••• 0001");
  assertEquals(JSON.stringify(identity).includes("250788000001"), false);
});

Deno.test("MTN pairing rejects invalid or non-MTN Rwanda numbers", async () => {
  await assertRejects(
    () => buildMtnMomoPairingIdentity("0712 345 678"),
    Error,
    "mtn_momo_msisdn_invalid",
  );
});
