import "server-only";

// Generates a high-entropy bearer token shown to the caller exactly
// once, plus the SHA-256 hex digest that is what actually gets
// persisted. The plaintext token itself is never written to the
// database, logged, or returned from this module a second time -
// callers must capture the return value at creation time or lose it,
// exactly like the database itself would.

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

export type GeneratedToken = {
  secret: string;
  hash: string;
  prefix: string;
};

export async function hashToken(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(secret),
  );
  return toHex(new Uint8Array(digest));
}

async function generateToken(prefix: string): Promise<GeneratedToken> {
  const randomBytes = crypto.getRandomValues(new Uint8Array(32));
  const secret = `${prefix}${toBase64Url(randomBytes)}`;
  const hash = await hashToken(secret);

  return { secret, hash, prefix: secret.slice(0, 8) };
}

// Retained as the name every ingestion-connection call site already
// uses; see supabase/migrations/20260823000000_phase_c_accounts_and_ingestion_connections.sql
// for ingestion_connections.credential_hash, and ingest-momo for the
// matching authentication check.
export type GeneratedCredential = GeneratedToken;

export function generateIngestionCredential(): Promise<GeneratedCredential> {
  return generateToken("pfe_");
}

// Same scheme, used for workspace_invites.token_hash - see
// supabase/migrations/20260827000000_organization_workspaces.sql.
export function generateInviteToken(): Promise<GeneratedToken> {
  return generateToken("inv_");
}

// Developer API bearer key (Integrations Phase 4). Stored only as
// api_keys.key_hash; the `olk_` plaintext is revealed to the creator
// exactly once. `prefix` here is the first 8 chars, kept on the row to
// identify a key in the UI without revealing it.
export function generateApiKey(): Promise<GeneratedToken> {
  return generateToken("olk_");
}
