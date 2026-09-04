import { withApiV1 } from "../../../../lib/api/handler";
import { apiOk, parseLimit } from "../../../../lib/api/respond";
import { listExports } from "../../../../lib/api/read-models";

// GET /api/v1/exports?limit&cursor — scope exports:read. Metadata only;
// the download URL is on GET /api/v1/exports/:id.
export const GET = withApiV1("exports:read", async (ctx) => {
  const p = ctx.url.searchParams;
  const { items, nextCursor } = await listExports(
    ctx.admin,
    ctx.workspaceId,
    parseLimit(p.get("limit")),
    p.get("cursor"),
  );
  return apiOk(items, { meta: { next_cursor: nextCursor } });
});
