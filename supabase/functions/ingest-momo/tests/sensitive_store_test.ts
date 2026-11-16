import { assertEquals } from "jsr:@std/assert@1";
import { open, parseKeyring } from "../../_shared/sensitive-crypto.ts";
import { sensitiveAad, storeUtilityToken } from "../sensitive-store.ts";

const K = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));

function fakeClient(error: { message: string } | null = null, throws = false) {
  const rows: Record<string, unknown>[] = [];
  return {
    rows,
    client: {
      from: (_t: string) => ({
        insert: (row: Record<string, unknown>) => {
          if (throws) throw new Error("boom");
          rows.push(row);
          return Promise.resolve({ error });
        },
      }),
    },
  };
}

const base = {
  transactionId: "tx-1",
  workspaceId: "ws-1",
  token: "12345678901234567890",
};

Deno.test("stores only ciphertext: the row never contains the token, and it decrypts with the bound AAD", async () => {
  const ring = await parseKeyring(`k1:${K}`);
  const f = fakeClient();
  assertEquals(
    await storeUtilityToken({ ...base, client: f.client, enabled: true, ring }),
    "stored",
  );
  const row = f.rows[0];
  assertEquals(JSON.stringify(row).includes(base.token), false);
  assertEquals(Object.keys(row).sort(), [
    "ciphertext",
    "key_id",
    "kind",
    "nonce",
    "transaction_id",
    "workspace_id",
  ]);
  const plain = await open(
    {
      keyId: row.key_id as string,
      nonce: row.nonce as string,
      ciphertext: row.ciphertext as string,
    },
    ring!,
    sensitiveAad("tx-1", "utility_token"),
  );
  assertEquals(plain, base.token);
});

Deno.test("no key or capture disabled: nothing is stored, nothing in plaintext", async () => {
  const ring = await parseKeyring(`k1:${K}`);
  const a = fakeClient(), b = fakeClient();
  assertEquals(
    await storeUtilityToken({
      ...base,
      client: a.client,
      enabled: true,
      ring: null,
    }),
    "no_key",
  );
  assertEquals(
    await storeUtilityToken({
      ...base,
      client: b.client,
      enabled: false,
      ring,
    }),
    "disabled",
  );
  assertEquals(a.rows.length + b.rows.length, 0);
});

Deno.test("a failing insert (error or throw) is reported, never thrown", async () => {
  const ring = await parseKeyring(`k1:${K}`);
  assertEquals(
    await storeUtilityToken({
      ...base,
      client: fakeClient({ message: "x" }).client,
      enabled: true,
      ring,
    }),
    "insert_failed",
  );
  assertEquals(
    await storeUtilityToken({
      ...base,
      client: fakeClient(null, true).client,
      enabled: true,
      ring,
    }),
    "insert_failed",
  );
});
