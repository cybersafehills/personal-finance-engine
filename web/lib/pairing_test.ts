import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1";
import {
  generatePairingToken,
  hashPairingToken,
  PAIRING_TOKEN_PATTERN,
  pairingErrorMessage,
  pairingTokenPrefix,
} from "./pairing.ts";

Deno.test("generatePairingToken: matches the shared Edge pattern and DB prefix shape", () => {
  for (let i = 0; i < 200; i++) {
    const { token, prefix } = generatePairingToken();
    assertMatch(token, PAIRING_TOKEN_PATTERN);
    assertMatch(prefix, /^olp_[A-Za-z0-9]{4}$/);
    assertEquals(token.slice(0, 8), prefix);
    // 128-bit body -> 26 base32 chars, so the token is comfortably long.
    assert(token.length >= 34);
  }
});

Deno.test("generatePairingToken: tokens are unique across many draws", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 1000; i++) seen.add(generatePairingToken().token);
  assertEquals(seen.size, 1000);
});

Deno.test("hashPairingToken: lowercase 64-hex, stable, matches the DB column regex", async () => {
  const { token } = generatePairingToken();
  const a = await hashPairingToken(token);
  const b = await hashPairingToken(token);
  assertMatch(a, /^[0-9a-f]{64}$/);
  assertEquals(a, b);
  const other = await hashPairingToken(generatePairingToken().token);
  assert(a !== other);
});

Deno.test("pairingTokenPrefix: returns olp_XXXX for a real token, null otherwise", () => {
  const { token, prefix } = generatePairingToken();
  assertEquals(pairingTokenPrefix(token), prefix);
  assertEquals(pairingTokenPrefix("not-a-token"), null);
  assertEquals(pairingTokenPrefix("olp_ab"), null);
});

Deno.test("pairingErrorMessage: every known code has non-technical copy; unknown falls back", () => {
  for (
    const code of [
      "PAIRING_EXPIRED",
      "PAIRING_ALREADY_USED",
      "INVALID_DEVICE_CREDENTIAL",
      "RATE_LIMITED",
    ]
  ) {
    const copy = pairingErrorMessage(code);
    assert(copy.length > 0);
    assert(!copy.includes("PAIRING_"));
    assert(!copy.includes("_"));
  }
  assertEquals(
    pairingErrorMessage("something_unmapped"),
    "Something went wrong. Please try again in a moment.",
  );
  assertEquals(
    pairingErrorMessage(null),
    "Something went wrong. Please try again in a moment.",
  );
});
