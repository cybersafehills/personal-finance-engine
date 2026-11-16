import { NextRequest } from "next/server";

import { parseCreateIntent } from "../../../../../lib/mobile-pay";
import {
  MobileApiError,
  mobilePost,
  mobilePostOptions,
  mobileSessionFresh,
} from "../../../../../lib/mobile-request";
import { createPaymentIntent } from "../../../../../lib/pay/create-intent";
import { isAssistedPayEnabled, paymentSessionFreshnessMinutes } from "../../../../../lib/pay/gate";
import { loadMobileIntent } from "../../../../../lib/pay/mobile-intent";
import { getActiveWorkspaceId } from "../../../../../lib/queries";
import { supabaseSession } from "../../../../../lib/supabase-session-server";

// POST /api/mobile/pay/intents - prepare a draft payment ("Pay X again") for
// the mobile app (ADR 0019). Never charges anything: the result is a `draft`
// plus the USSD instruction to hand off with.
//
// It shares lib/pay/create-intent.ts with the web server action, so validation,
// the directory service code and the idempotent create_payment_intent RPC
// (membership-checked, deduped on (workspace, idempotency_key)) are one code
// path. The paying account's network comes from its own row. On top of the shared bearer guard (flag, rate limit, token validated,
// second factor complete = the web's MFA step-up) this checks the assisted-pay
// gate and that any source account belongs to the workspace, which the RPC does
// not. The client sends a request id, so a double tap returns the same intent.
// The intent is created in the user's personal workspace (no session cookie).

export const OPTIONS = mobilePostOptions;

export function POST(request: NextRequest) {
  return mobilePost(request, "pay-intent", async (body, { token }) => {
    const workspaceId = await getActiveWorkspaceId();
    if (!isAssistedPayEnabled(workspaceId)) {
      throw new MobileApiError(
        403,
        "feature_disabled",
        "Assisted Quick Pay is turned off for your account.",
      );
    }

    const parsed = parseCreateIntent(body);
    if (!parsed.ok) throw new MobileApiError(422, "invalid_request", parsed.message);
    const req = parsed.value;

    const supabase = await supabaseSession();

    // The RPC only checks workspace membership, so make sure the paying
    // account is one of this workspace's own - and read its network from the
    // row, never from the client: a merchant payment has no phone number to say
    // which network's USSD to dial, so the paying account's own network decides.
    let accountProvider: string | null = null;
    if (req.sourceAccountId) {
      const { data } = await supabase
        .from("accounts")
        .select("id, provider")
        .eq("id", req.sourceAccountId)
        .eq("workspace_id", workspaceId)
        .eq("is_active", true)
        .maybeSingle();
      if (!data) throw new MobileApiError(422, "invalid_account", "That account isn't available.");
      accountProvider = (data as { provider: string | null }).provider;
    }

    const created = await createPaymentIntent({
      supabase,
      workspaceId,
      input: {
        paymentType: req.paymentType,
        amountMinor: req.amountMinor,
        recipientName: req.recipientName,
        recipientMsisdn: req.recipientMsisdn,
        merchantCode: req.merchantCode,
        sourceAccountId: req.sourceAccountId,
        idempotencyKey: req.idempotencyKey,
      },
      accountProvider,
      sessionFresh: mobileSessionFresh(token, paymentSessionFreshnessMinutes()),
    });
    if (!created.ok) throw new MobileApiError(422, "could_not_prepare", created.error);

    const intent = await loadMobileIntent(created.id);
    if (!intent) throw new Error("prepared intent not readable");
    return { intent, existed: created.existed === true };
  });
}
