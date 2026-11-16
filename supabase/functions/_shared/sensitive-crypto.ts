// Application-level encryption for sensitive bearer values (e.g. prepaid
// electricity tokens) - AES-256-GCM via WebCrypto, so it runs identically in
// Deno (Edge Functions) and Node (Next.js). Pure: keys are passed in.
//
// THIS FILE IS DUPLICATED byte-for-byte at web/lib/sensitive-crypto.ts (the
// Edge runtime and the Next app cannot share a module); the CI step
// "sensitive-crypto copies match" fails if the two ever differ.
//
// Design:
//  - The database only ever stores {key_id, nonce, ciphertext}; the key lives
//    in the app/edge environment, never in the database or its backups.
//  - AAD binds a ciphertext to the exact row it was made for (e.g.
//    "<transaction_id>:utility_token"), so a ciphertext copied to another row
//    fails to decrypt.
//  - A KEYRING supports rotation: the FIRST key encrypts; every key listed can
//    decrypt. Format: "k2:<base64 32 bytes>,k1:<base64 32 bytes>".
//  - Nothing is ever returned or logged on failure except a generic error.

export type Keyring = { currentId: string; keys: Map<string, CryptoKey> };
export type SealedValue = { keyId: string; nonce: string; ciphertext: string };

const KEY_ID = /^[A-Za-z0-9_-]{1,32}$/;

function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function b64encode(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
}
function buf(u: Uint8Array): ArrayBuffer {
  return u.buffer.slice(
    u.byteOffset,
    u.byteOffset + u.byteLength,
  ) as ArrayBuffer;
}

/** Parses the keyring env value; returns null when unset/empty. Throws on a malformed entry. */
export async function parseKeyring(
  raw: string | undefined | null,
): Promise<Keyring | null> {
  const text = (raw ?? "").trim();
  if (!text) return null;
  const keys = new Map<string, CryptoKey>();
  let currentId = "";
  for (const entry of text.split(",")) {
    const i = entry.indexOf(":");
    const id = entry.slice(0, i).trim();
    const b64 = entry.slice(i + 1).trim();
    if (i < 1 || !KEY_ID.test(id) || keys.has(id)) {
      throw new Error("invalid_keyring");
    }
    let bytes: Uint8Array;
    try {
      bytes = b64decode(b64);
    } catch {
      throw new Error("invalid_keyring");
    }
    if (bytes.length !== 32) throw new Error("invalid_keyring");
    keys.set(
      id,
      await crypto.subtle.importKey("raw", buf(bytes), "AES-GCM", false, [
        "encrypt",
        "decrypt",
      ]),
    );
    if (!currentId) currentId = id;
  }
  return { currentId, keys };
}

export async function seal(
  plaintext: string,
  ring: Keyring,
  aad: string,
): Promise<SealedValue> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: buf(nonce),
      additionalData: buf(new TextEncoder().encode(aad)),
    },
    ring.keys.get(ring.currentId)!,
    buf(new TextEncoder().encode(plaintext)),
  );
  return {
    keyId: ring.currentId,
    nonce: b64encode(nonce),
    ciphertext: b64encode(new Uint8Array(ct)),
  };
}

/** Returns the plaintext, or throws a generic "decrypt_failed" (never says why). */
export async function open(
  sealed: SealedValue,
  ring: Keyring,
  aad: string,
): Promise<string> {
  try {
    const key = ring.keys.get(sealed.keyId);
    if (!key) throw new Error("no key");
    const pt = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: buf(b64decode(sealed.nonce)),
        additionalData: buf(new TextEncoder().encode(aad)),
      },
      key,
      buf(b64decode(sealed.ciphertext)),
    );
    return new TextDecoder().decode(pt);
  } catch {
    throw new Error("decrypt_failed");
  }
}
