import {
  assertEquals,
  assertNotEquals,
  assertRejects,
} from "jsr:@std/assert@1";
import { open, parseKeyring, seal } from "./sensitive-crypto.ts";

const K1 = btoa(String.fromCharCode(...new Uint8Array(32).fill(1)));
const K2 = btoa(String.fromCharCode(...new Uint8Array(32).fill(2)));

Deno.test("round trip; ciphertext differs per call (fresh nonce) and hides the value", async () => {
  const ring = (await parseKeyring(`k1:${K1}`))!;
  const a = await seal("12345678901234567890", ring, "tx1:utility_token");
  const b = await seal("12345678901234567890", ring, "tx1:utility_token");
  assertNotEquals(a.nonce, b.nonce);
  assertNotEquals(a.ciphertext, b.ciphertext);
  assertEquals(a.keyId, "k1");
  assertEquals(a.ciphertext.includes("1234"), false);
  assertEquals(
    await open(a, ring, "tx1:utility_token"),
    "12345678901234567890",
  );
});

Deno.test("a ciphertext is bound to its row (AAD) and fails if tampered or moved", async () => {
  const ring = (await parseKeyring(`k1:${K1}`))!;
  const s = await seal("secret", ring, "tx1:utility_token");
  await assertRejects(
    () => open(s, ring, "tx2:utility_token"),
    Error,
    "decrypt_failed",
  );
  await assertRejects(
    () =>
      open(
        { ...s, ciphertext: s.ciphertext.slice(0, -4) + "AAAA" },
        ring,
        "tx1:utility_token",
      ),
    Error,
    "decrypt_failed",
  );
  await assertRejects(
    () =>
      open({ ...s, nonce: btoa("x".repeat(12)) }, ring, "tx1:utility_token"),
    Error,
    "decrypt_failed",
  );
});

Deno.test("wrong key fails with a generic error that reveals nothing", async () => {
  const r1 = (await parseKeyring(`k1:${K1}`))!;
  const other = (await parseKeyring(`k1:${K2}`))!;
  const s = await seal("secret", r1, "a");
  const err = await assertRejects(() => open(s, other, "a"), Error);
  assertEquals(err.message, "decrypt_failed");
});

Deno.test("rotation: the first key encrypts, every listed key decrypts", async () => {
  const old = (await parseKeyring(`k1:${K1}`))!;
  const sealedOld = await seal("legacy", old, "a");
  const ring = (await parseKeyring(`k2:${K2},k1:${K1}`))!;
  assertEquals(ring.currentId, "k2");
  assertEquals((await seal("new", ring, "a")).keyId, "k2");
  assertEquals(await open(sealedOld, ring, "a"), "legacy");
  // a key id that was retired from the ring can no longer be opened
  const retired = (await parseKeyring(`k2:${K2}`))!;
  await assertRejects(
    () => open(sealedOld, retired, "a"),
    Error,
    "decrypt_failed",
  );
});

Deno.test("keyring parsing: unset -> null; malformed -> throws (never a weak key)", async () => {
  assertEquals(await parseKeyring(undefined), null);
  assertEquals(await parseKeyring("  "), null);
  for (
    const bad of [
      "nocolon",
      `:${K1}`,
      "k1:not-base64!!",
      `k1:${btoa("short")}`,
      `k1:${K1},k1:${K2}`,
      `bad id:${K1}`,
    ]
  ) {
    await assertRejects(() => parseKeyring(bad), Error, "invalid_keyring");
  }
});
