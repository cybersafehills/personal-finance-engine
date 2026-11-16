import "server-only";
import { supabaseSession } from "../supabase-session-server";
import { open, parseKeyring } from "../sensitive-crypto";
import { friendlyRevealError, isUtilityTokenFeatureEnabled } from "./token-format";

// Server-side read path for a prepaid-electricity token. Authorisation, the
// hourly limit and the audit trail live in the database function
// reveal_transaction_sensitive_detail (which returns only the SEALED value);
// decryption happens here with a key that exists only in this server's
// environment (SENSITIVE_DATA_KEYRING). The plaintext is returned to the caller
// for one response and never stored, cached or logged.

export function utilityTokenFeatureOn(): boolean {
  return isUtilityTokenFeatureEnabled({
    UTILITY_TOKEN_CAPTURE_ENABLED: process.env.UTILITY_TOKEN_CAPTURE_ENABLED,
  });
}

/** Non-sensitive facts for the detail page (the token itself is never here). */
export async function getUtilityTokenMeta(
  transactionId: string,
): Promise<{ present: boolean; kwh: string | null }> {
  const supabase = await supabaseSession();
  const { data } = await supabase
    .from("transactions")
    .select("metadata")
    .eq("id", transactionId)
    .maybeSingle();
  const m = (data?.metadata ?? {}) as { utility_token_present?: boolean; kwh?: string };
  return { present: m.utility_token_present === true, kwh: typeof m.kwh === "string" ? m.kwh : null };
}

export type RevealResult = { ok: true; digits: string } | { ok: false; error: string };

export async function revealUtilityToken(transactionId: string): Promise<RevealResult> {
  if (!utilityTokenFeatureOn()) return { ok: false, error: "Token viewing isn't turned on." };
  let ring;
  try {
    ring = await parseKeyring(process.env.SENSITIVE_DATA_KEYRING);
  } catch {
    ring = null;
  }
  if (!ring) return { ok: false, error: "Token viewing isn't configured." };

  const supabase = await supabaseSession();
  const { data, error } = await supabase.rpc("reveal_transaction_sensitive_detail", {
    p_transaction_id: transactionId,
    p_kind: "utility_token",
  });
  const row = Array.isArray(data) ? data[0] : null;
  if (error || !row) return { ok: false, error: friendlyRevealError(error?.message ?? "sensitive_detail_not_found") };
  try {
    const digits = await open(
      { keyId: row.key_id, nonce: row.nonce, ciphertext: row.ciphertext },
      ring,
      `${transactionId}:utility_token`,
    );
    return { ok: true, digits };
  } catch {
    return { ok: false, error: friendlyRevealError("decrypt_failed") };
  }
}
