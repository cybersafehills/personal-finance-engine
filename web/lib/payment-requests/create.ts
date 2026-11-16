import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { siteUrl } from "../site-url";
import {
  buildPublicUrl,
  generateToken,
  hashToken,
  validateCreateInput,
} from "./payment-request";
import { friendlyRequestError, isAllowedExpiryHours } from "./owner";

// The single create path for payment requests, shared by the web server action
// and POST /api/mobile/payment-requests. Callers have ALREADY checked session,
// workspace and the feature flag (and MFA where it applies); this re-validates
// every field, generates the secret token (256-bit; only its SHA-256 digest is
// sent to the database), and returns the one-time URL.

export type CreateResult =
  | { ok: true; id: string; url: string; replayed: false }
  | { ok: true; id: string; url: null; replayed: true }
  | { ok: false; error: string };

export type CreateCore = {
  supabase: SupabaseClient;
  workspaceId: string;
  amountMinor: bigint;
  currency: string;
  destinationType: string;
  destinationValue: string;
  recipientDisplay: string;
  reference: string;
  expiresInHours: number;
  idempotencyKey: string;
};

const IDEM = /^[A-Za-z0-9-]{8,100}$/;

export async function createPaymentRequestCore(
  i: CreateCore,
): Promise<CreateResult> {
  if (
    i.destinationType !== "momo_phone" && i.destinationType !== "merchant_code"
  ) {
    return { ok: false, error: "Choose where the money should be sent." };
  }
  if (!isAllowedExpiryHours(i.expiresInHours)) {
    return { ok: false, error: "Choose how long the request stays valid." };
  }
  if (!IDEM.test(i.idempotencyKey)) {
    return { ok: false, error: "Please reload and try again." };
  }

  const expiresAt = new Date(Date.now() + i.expiresInHours * 3_600_000);
  const errors = validateCreateInput(
    {
      amountMinor: i.amountMinor,
      currency: i.currency,
      destinationType: i.destinationType,
      destinationValue: i.destinationValue,
      recipientDisplay: i.recipientDisplay,
      reference: i.reference,
      expiresAt,
    },
    new Date(),
  );
  if (errors.length > 0) {
    const code = errors.includes("invalid_destination")
      ? "invalid_destination"
      : errors.includes("invalid_expiry")
      ? "invalid_expiry"
      : "invalid_payment_request";
    return { ok: false, error: friendlyRequestError(code) };
  }

  let origin: string;
  try {
    origin = new URL(siteUrl()).origin;
    buildPublicUrl(origin, "0".repeat(64)); // throws unless a bare https origin
  } catch {
    return {
      ok: false,
      error:
        "Sharing links isn't configured yet (SITE_URL must be an https address).",
    };
  }

  // A double submit with the same key returns the original request. The token
  // exists only in this process and one response, so it can't be re-shown.
  const { data: existing } = await i.supabase
    .from("payment_requests")
    .select("id")
    .eq("workspace_id", i.workspaceId)
    .eq("idempotency_key", i.idempotencyKey)
    .maybeSingle();
  if (existing) return { ok: true, id: existing.id, url: null, replayed: true };

  const token = generateToken();
  const { data, error } = await i.supabase.rpc("create_payment_request", {
    p_workspace_id: i.workspaceId,
    p_amount_minor: i.amountMinor.toString(),
    p_currency: i.currency,
    p_destination_type: i.destinationType,
    p_destination_value: i.destinationValue,
    p_recipient_display: i.recipientDisplay,
    p_reference: i.reference.trim() === "" ? null : i.reference,
    p_expires_at: expiresAt.toISOString(),
    p_token_hash: await hashToken(token),
    p_idempotency_key: i.idempotencyKey,
  });
  if (error || typeof data !== "string") {
    return { ok: false, error: friendlyRequestError(error?.message) };
  }
  return {
    ok: true,
    id: data,
    url: buildPublicUrl(origin, token),
    replayed: false,
  };
}
