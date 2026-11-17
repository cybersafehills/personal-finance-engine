import { NextRequest } from "next/server";

import { isBillsEnabled, isBillsExtractionEnabled } from "../../../../../lib/bills/gate";
import { getMobileBillBundle } from "../../../../../lib/bills/mobile-queries";
import { MobileApiError, mobileGet, mobileOptions } from "../../../../../lib/mobile-request";
import { toMobileBillDetail } from "../../../../../lib/mobile-bills";
import { getActiveWorkspaceId } from "../../../../../lib/queries";

// GET /api/mobile/bills/:id - one document in the Space the app is viewing:
// its details, and (when automated extraction is on for the Space) the extracted
// fields and the checks, plus the processing history for members allowed to see
// it. A document that is in another Space answers 404, exactly like one that does
// not exist. The original file is not part of this response.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const OPTIONS = mobileOptions;

export function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return mobileGet(request, "bills-detail", async () => {
    const { id } = await params;
    const workspaceId = await getActiveWorkspaceId();
    if (!workspaceId || !isBillsEnabled(workspaceId)) {
      throw new MobileApiError(404, "not_found", "Bills isn't available here.");
    }
    if (!UUID.test(id)) {
      throw new MobileApiError(404, "not_found", "That document wasn't found.");
    }
    const bundle = await getMobileBillBundle(id, workspaceId, {
      extractionEnabled: isBillsExtractionEnabled(workspaceId),
    });
    if (!bundle) {
      throw new MobileApiError(404, "not_found", "That document wasn't found.");
    }
    return { bill: toMobileBillDetail(bundle) };
  });
}
