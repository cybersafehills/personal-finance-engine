import "server-only";
import { supabaseSession } from "../supabase-session-server";
import { open, parseKeyring } from "../sensitive-crypto";
import {
  friendlyRevealError,
  isUtilityTokenFeatureEnabled,
  kwhText,
} from "./token-format";

// Server-side read path for a prepaid-electricity token. Authorisation, the
// hourly limit and the audit trail live in the database function
// reveal_transaction_sensitive_detail (which returns only the SEALED value and
// which row it came from); decryption happens here with a key that exists only
// in this server's environment (SENSITIVE_DATA_KEYRING). The plaintext is
// returned to the caller for one response and never stored, cached or logged.

export function utilityTokenFeatureOn(): boolean {
  return isUtilityTokenFeatureEnabled({
    UTILITY_TOKEN_CAPTURE_ENABLED: process.env.UTILITY_TOKEN_CAPTURE_ENABLED,
  });
}

export type ReceiptInfo = {
  id: string;
  status: "matched" | "unmatched" | "ambiguous" | "ignored";
  kwh: string; // dot-decimal, from the integer thousandths
  meterLast4: string | null;
  hasToken: boolean;
};

/** Non-sensitive facts for the detail page (the token itself is never here). */
export async function getUtilityTokenMeta(
  transactionId: string,
): Promise<
  { present: boolean; kwh: string | null; receipt: ReceiptInfo | null }
> {
  const supabase = await supabaseSession();
  const [{ data: tx }, { data: rc }] = await Promise.all([
    supabase.from("transactions").select("metadata").eq("id", transactionId)
      .maybeSingle(),
    // column-level grant: token_* columns are not selectable, has_token is
    supabase
      .from("utility_receipts")
      .select("id, status, kwh_milli, meter_last4, has_token")
      .eq("transaction_id", transactionId)
      .maybeSingle(),
  ]);
  const m = (tx?.metadata ?? {}) as {
    utility_token_present?: boolean;
    kwh?: string;
  };
  const receipt: ReceiptInfo | null = rc
    ? {
      id: rc.id,
      status: rc.status,
      kwh: kwhText(Number(rc.kwh_milli)),
      meterLast4: rc.meter_last4 ?? null,
      hasToken: rc.has_token === true,
    }
    : null;
  return {
    present: m.utility_token_present === true || (receipt?.hasToken ?? false),
    kwh: receipt?.kwh ?? (typeof m.kwh === "string" ? m.kwh : null),
    receipt,
  };
}

export type RevealResult = { ok: true; digits: string } | {
  ok: false;
  error: string;
};

export async function revealUtilityToken(
  transactionId: string,
): Promise<RevealResult> {
  if (!utilityTokenFeatureOn()) {
    return { ok: false, error: "Token viewing isn't turned on." };
  }
  let ring;
  try {
    ring = await parseKeyring(process.env.SENSITIVE_DATA_KEYRING);
  } catch {
    ring = null;
  }
  if (!ring) return { ok: false, error: "Token viewing isn't configured." };

  const supabase = await supabaseSession();
  const { data, error } = await supabase.rpc(
    "reveal_transaction_sensitive_detail",
    {
      p_transaction_id: transactionId,
      p_kind: "utility_token",
    },
  );
  const row = Array.isArray(data) ? data[0] : null;
  if (error || !row) {
    return {
      ok: false,
      error: friendlyRevealError(
        error?.message ?? "sensitive_detail_not_found",
      ),
    };
  }
  // Bind the ciphertext to the row it came from: the E5 table is keyed by the
  // transaction, a receipt by its own id. A sealed value copied elsewhere fails.
  const aad = row.source === "receipt"
    ? `${row.row_id}:utility_receipt`
    : `${row.row_id}:utility_token`;
  try {
    const digits = await open(
      { keyId: row.key_id, nonce: row.nonce, ciphertext: row.ciphertext },
      ring,
      aad,
    );
    return { ok: true, digits };
  } catch {
    return { ok: false, error: friendlyRevealError("decrypt_failed") };
  }
}
