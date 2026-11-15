import "server-only";
import { createClient } from "@supabase/supabase-js";
import { hashToken, isValidToken } from "./payment-request";
import {
  type PublicPaymentRequestView,
  type ResolveRow,
  toPublicView,
} from "./public-view";

export type ResolveResult =
  | { kind: "not_found" }
  | { kind: "unavailable" }
  | { kind: "found"; view: PublicPaymentRequestView };

/**
 * Resolve a shared payment-request token for the PUBLIC page. Uses the ANON
 * key (not the service role): the only thing anon may call is the
 * resolve_payment_request function, which takes the SHA-256 digest - the raw
 * token never leaves this process. A malformed token is "not found" without
 * any network call. Infrastructure failure is "unavailable" (never leaks why).
 */
export async function resolvePaymentRequestToken(
  token: string,
): Promise<ResolveResult> {
  if (!isValidToken(token)) return { kind: "not_found" };
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return { kind: "unavailable" };

  const supabase = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.rpc("resolve_payment_request", {
    p_token_hash: await hashToken(token),
  });
  if (error) return { kind: "unavailable" };
  const row = (data as ResolveRow[] | null)?.[0];
  if (!row) return { kind: "not_found" };
  const view = toPublicView(row);
  return view ? { kind: "found", view } : { kind: "not_found" };
}
