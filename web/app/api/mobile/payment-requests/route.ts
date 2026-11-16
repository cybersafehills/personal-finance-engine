import { NextRequest } from "next/server";
import { MobileApiError, mobileOptions, mobilePost } from "../../../../lib/mobile-request";
import { requireFlag, resolveMobileWorkspace } from "../../../../lib/mobile-workspace";
import { supabaseSession } from "../../../../lib/supabase-session-server";
import { createPaymentRequestCore } from "../../../../lib/payment-requests/create";
import { parseMobileCreateBody } from "../../../../lib/payment-requests/owner";

// POST /api/mobile/payment-requests - create a NON-CUSTODIAL payment request
// and get its one-time share link. The server generates the secret token and
// stores only its digest, so the link is returned exactly once. Cancel / mark
// paid / link a payment are the RPCs cancel_payment_request,
// mark_payment_request_paid_by_owner and link_payment_request_transaction,
// which the app calls directly under RLS (docs/mobile-api.md). Dark unless
// PAYMENT_REQUESTS_ENABLED (+ optional allowlist) covers the workspace.

export const OPTIONS = mobileOptions;

export function POST(request: NextRequest) {
  return mobilePost(request, "payment-requests", async () => {
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      throw new MobileApiError(400, "invalid_request");
    }
    const body = parseMobileCreateBody(raw);
    if (!body) throw new MobileApiError(400, "invalid_request");

    const requested = typeof (raw as Record<string, unknown>).workspace_id === "string"
      ? ((raw as Record<string, unknown>).workspace_id as string)
      : null;
    const { workspaceId } = await resolveMobileWorkspace(requested);
    requireFlag("PAYMENT_REQUESTS", workspaceId);

    const res = await createPaymentRequestCore({
      supabase: await supabaseSession(),
      workspaceId,
      ...body,
    });
    if (!res.ok) throw new MobileApiError(422, "payment_request_rejected", res.error);
    return { id: res.id, url: res.url, replayed: res.replayed };
  });
}
