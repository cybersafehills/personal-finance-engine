import { type Keyring, seal } from "../_shared/sensitive-crypto.ts";

// Encrypted, best-effort storage of a utility token next to its transaction.
// Never throws, never logs the value, never stores plaintext: with no key
// configured (or capture switched off) the token is simply not kept. The
// transaction is already durably stored before this runs.

export type SensitiveStoreOutcome =
  | "stored"
  | "disabled"
  | "no_key"
  | "insert_failed"
  | "encrypt_failed";

type InsertClient = {
  from(table: string): {
    insert(
      row: Record<string, unknown>,
    ): PromiseLike<{ error: { message: string } | null }>;
  };
};

export const SENSITIVE_KIND = "utility_token";

/** The AAD that binds the ciphertext to its transaction and kind. */
export function sensitiveAad(transactionId: string, kind: string): string {
  return `${transactionId}:${kind}`;
}

export async function storeUtilityToken(args: {
  client: InsertClient;
  enabled: boolean;
  ring: Keyring | null;
  transactionId: string;
  workspaceId: string;
  token: string;
}): Promise<SensitiveStoreOutcome> {
  if (!args.enabled) return "disabled";
  if (!args.ring) return "no_key";
  let sealed;
  try {
    sealed = await seal(
      args.token,
      args.ring,
      sensitiveAad(args.transactionId, SENSITIVE_KIND),
    );
  } catch {
    return "encrypt_failed";
  }
  try {
    const { error } = await args.client.from("transaction_sensitive_details")
      .insert({
        transaction_id: args.transactionId,
        workspace_id: args.workspaceId,
        kind: SENSITIVE_KIND,
        key_id: sealed.keyId,
        nonce: sealed.nonce,
        ciphertext: sealed.ciphertext,
      });
    return error ? "insert_failed" : "stored";
  } catch {
    return "insert_failed";
  }
}
