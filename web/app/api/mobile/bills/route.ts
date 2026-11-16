import { NextRequest } from "next/server";

import { isBillsEnabled } from "../../../../lib/bills/gate";
import {
  getMobileBillList,
  MOBILE_BILLS_PAGE,
  parseBillStatusFilter,
} from "../../../../lib/bills/mobile-queries";
import { MobileApiError, mobileGet, mobileOptions } from "../../../../lib/mobile-request";
import { toMobileBillListItem } from "../../../../lib/mobile-bills";
import { getActiveWorkspaceId } from "../../../../lib/queries";

// GET /api/mobile/bills[?status=...] - the documents (invoices and receipts) in
// the Space the app is viewing, newest first, for the mobile app (ADR 0019).
// Read-only. The same per-Space gate as the web's /bills: when Bills is off for
// the Space the answer is 404 not_found, as the web page's notFound(). Scoped to
// the active Space explicitly (see lib/bills/mobile-queries.ts), newest 50 with
// `hasMore` when there are older ones.

export const OPTIONS = mobileOptions;

export function GET(request: NextRequest) {
  return mobileGet(request, "bills", async () => {
    const workspaceId = await getActiveWorkspaceId();
    if (!workspaceId || !isBillsEnabled(workspaceId)) {
      throw new MobileApiError(404, "not_found", "Bills isn't available here.");
    }
    const status = parseBillStatusFilter(request.nextUrl.searchParams.get("status"));
    if (status === null) {
      throw new MobileApiError(400, "invalid_status", "That isn't a document status.");
    }
    const { rows, hasMore } = await getMobileBillList(workspaceId, status);
    return { bills: rows.map(toMobileBillListItem), hasMore, pageSize: MOBILE_BILLS_PAGE };
  });
}
