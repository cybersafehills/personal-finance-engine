import { bearerPost, failureForOutcome } from "@/api/bearer";
import { supabase } from "@/api/supabase";

// Prepaid-electricity ("Cash Power") receipts: the vendor's own SMS, linked to
// the MoMo payment by the server. The app reads the non-sensitive facts under
// RLS (the token columns are not selectable by any client role) and asks the
// server to reveal the token only on request - an audited, rate-limited call
// that also needs the second factor.

export type Receipt = {
  id: string;
  kwh: string;
  meterLast4: string | null;
  /** A token was kept and can be asked for. */
  hasToken: boolean;
};

/** kWh x 1000 (an integer) -> "11.9": trailing zeros trimmed. */
export function kwhText(milli: number): string {
  const whole = Math.trunc(milli / 1000);
  const frac = String(Math.abs(milli) % 1000).padStart(3, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : String(whole);
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** A row of utility_receipts (matched receipts only) as PostgREST returns it. */
export function parseReceiptRow(raw: unknown): Receipt | null {
  if (!isRecord(raw) || typeof raw.id !== "string" || raw.id === "") return null;
  if (raw.status !== "matched") return null;
  const milli = raw.kwh_milli;
  if (typeof milli !== "number" || !Number.isInteger(milli) || milli <= 0) return null;
  const m4 = typeof raw.meter_last4 === "string" && /^\d{4}$/.test(raw.meter_last4) ? raw.meter_last4 : null;
  return { id: raw.id, kwh: kwhText(milli), meterLast4: m4, hasToken: raw.has_token === true };
}

export async function getReceiptForTransaction(transactionId: string): Promise<Receipt | null> {
  if (!supabase) return null;
  const { data } = await supabase
    .from("utility_receipts")
    .select("id, status, kwh_milli, meter_last4, has_token")
    .eq("transaction_id", transactionId)
    .maybeSingle();
  return parseReceiptRow(data);
}

/** Groups a 20-digit token in fours: 1234-5678-9012-3456-7890. */
export function formatToken(digits: string): string {
  return digits.replace(/[^0-9]/g, "").replace(/(\d{4})(?=\d)/g, "$1-");
}

export type RevealResult = { ok: true; token: string } | { ok: false; message: string };

export function parseRevealResponse(status: number, body: unknown): RevealResult {
  if (status === 200 && isRecord(body) && body.ok === true && typeof body.token === "string" && /^\d{4}(-\d{4}){4}$/.test(body.token)) {
    return { ok: true, token: body.token };
  }
  if (status === 403) return { ok: false, message: "Finish two-step verification to view the token." };
  if (status === 404) return { ok: false, message: "This token isn't available to you." };
  if (status === 401) return { ok: false, message: "Please sign in again." };
  if (status === 422 && isRecord(body) && typeof body.message === "string" && body.message.length <= 200) {
    return { ok: false, message: body.message };
  }
  return { ok: false, message: "Couldn't show the token. Check your connection and try again." };
}

export async function revealToken(transactionId: string): Promise<RevealResult> {
  const result = await bearerPost(`/api/mobile/transactions/${encodeURIComponent(transactionId)}/reveal-token`, {});
  if (result.kind !== "response") return { ok: false, message: failureForOutcome(result, "The token").message };
  return parseRevealResponse(result.status, result.body);
}
