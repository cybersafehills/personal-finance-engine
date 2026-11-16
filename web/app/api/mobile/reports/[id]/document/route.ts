import { NextRequest } from "next/server";

import { isUuid } from "../../../../../../lib/mobile-pay";
import { mobileGet, mobileOptions } from "../../../../../../lib/mobile-request";
import { createReportDownload } from "../../../../../../lib/report-download";

// GET /api/mobile/reports/:id/document - a fresh, short-lived signed URL for a
// report's PDF, as JSON (not a redirect: the app fetches with a bearer token and
// then opens the URL). Ownership is the caller's own RLS session
// (lib/report-download.ts). The app asks again on every tap; the URL lives five
// minutes and must never be stored or logged. Rendering a PDF is expensive, so
// this has its own rate-limit bucket.

export const OPTIONS = mobileOptions;

type Reason = "not_found" | "not_ready" | "failed";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return mobileGet(request, "report-document", async () => {
    const none = (reason: Reason) => ({ download: null, reason });
    if (!isUuid(id)) return none("not_found");
    // strict: a failed lookup is a retryable error, never "not found".
    const result = await createReportDownload(id, { strict: true });
    if (result.ok) return { download: { url: result.url } };
    return none(
      result.status === 404 ? "not_found" : result.status === 409 ? "not_ready" : "failed",
    );
  });
}
