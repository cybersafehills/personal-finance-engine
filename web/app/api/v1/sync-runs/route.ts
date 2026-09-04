import { withApiV1 } from "../../../../lib/api/handler";
import { apiOk, parseLimit } from "../../../../lib/api/respond";
import { listSyncRuns } from "../../../../lib/api/read-models";

// GET /api/v1/sync-runs?limit&cursor — scope sync:read. Integration sync
// run history (workbooks + accounting ledgers).
export const GET = withApiV1("sync:read", async (ctx) => {
  const p = ctx.url.searchParams;
  const { items, nextCursor } = await listSyncRuns(
    ctx.admin,
    ctx.workspaceId,
    parseLimit(p.get("limit")),
    p.get("cursor"),
  );
  return apiOk(items, { meta: { next_cursor: nextCursor } });
});
