import { NextRequest } from "next/server";
import { MobileApiError, mobileOptions, mobilePost } from "../../../../../../lib/mobile-request";
import { revealUtilityToken, utilityTokenFeatureOn } from "../../../../../../lib/sensitive/utility-token";
import { formatUtilityToken } from "../../../../../../lib/sensitive/token-format";

// POST /api/mobile/transactions/{id}/reveal-token - show a prepaid-electricity
// token. POST (not GET) because every call is an audited, rate-limited event.
// The bearer guard already requires a completed second factor. Authorisation
// (member+, source visibility), the 20/hour limit and the audit row live in the
// database function; decryption happens here with a server-only key. The token
// is returned once, `no-store`, and never logged. Dark unless
// UTILITY_TOKEN_CAPTURE_ENABLED=true and SENSITIVE_DATA_KEYRING is set.

export const OPTIONS = mobileOptions;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return mobilePost(request, "reveal-token", async () => {
    const { id } = await params;
    if (!UUID.test(id) || !utilityTokenFeatureOn()) throw new MobileApiError(404, "not_found");
    const r = await revealUtilityToken(id);
    if (!r.ok) throw new MobileApiError(r.error.includes("available") ? 404 : 422, r.error.includes("available") ? "not_found" : "reveal_failed", r.error);
    return { token: formatUtilityToken(r.digits) };
  });
}
