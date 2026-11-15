import { NextRequest } from "next/server";

import { isFinancialStatementsEnabled } from "../../../../../../lib/financial-statements";
import { mobileGet, mobileOptions } from "../../../../../../lib/mobile-request";
import { createStatementDownload } from "../../../../../../lib/statement-download";

// GET /api/mobile/statements/:id/document?format=pdf|csv - a fresh, short-lived
// signed download URL for one ready statement, as JSON (not a redirect: the app
// fetches with a bearer token and then opens the URL). Ownership is the
// caller's own RLS session (lib/statement-download.ts), and the download is
// audited like the web's. The app asks again on every tap; the URL lives five
// minutes and must never be stored or logged. Rendering a PDF is expensive, so
// this has its own rate-limit bucket.

export const OPTIONS = mobileOptions;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Reason = "unavailable" | "not_found" | "not_ready" | "failed";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const format = new URL(request.url).searchParams.get("format") === "csv"
    ? "csv"
    : "pdf";

  return mobileGet(request, "statement-document", async () => {
    const none = (reason: Reason) => ({ download: null, reason });
    if (!isFinancialStatementsEnabled()) return none("unavailable");
    if (!UUID.test(id)) return none("not_found");

    const result = await createStatementDownload(id, format);
    if (result.ok) {
      return { download: { url: result.url, filename: result.filename, format } };
    }
    return none(
      result.status === 404 ? "not_found" : result.status === 409 ? "not_ready" : "failed",
    );
  });
}
