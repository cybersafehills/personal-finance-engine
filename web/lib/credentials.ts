import "server-only";

// Generates a new ingestion-connection credential: a high-entropy secret
// shown to the caller exactly once, plus the SHA-256 hex digest that is
// what actually gets persisted (see ingestion_connections.credential_hash
// in the Phase C migration, and the same hashing scheme ingest-momo uses
// to authenticate a presented credential). The plaintext secret itself is
// never written to the database, logged, or returned from this module a
// second time - callers must capture the return value at creation/
// rotation time or lose it, exactly like the database itself would.

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(
    /=+$/,
    "",
  );
}

export type GeneratedCredential = {
  secret: string;
  hash: string;
  prefix: string;
};

export async function generateIngestionCredential(): Promise<
  GeneratedCredential
> {
  const randomBytes = crypto.getRandomValues(new Uint8Array(32));
  const secret = `pfe_${toBase64Url(randomBytes)}`;

  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(secret),
  );
  const hash = toHex(new Uint8Array(digest));

  return { secret, hash, prefix: secret.slice(0, 8) };
}
