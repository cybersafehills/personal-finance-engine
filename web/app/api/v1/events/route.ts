import { withApiV1 } from "../../../../lib/api/handler";
import { apiOk, parseLimit } from "../../../../lib/api/respond";
import { listEvents } from "../../../../lib/api/read-models";

// GET /api/v1/events?limit&cursor — scope events:read. The redacted
// integration_events activity feed (no payloads, no stack traces).
export const GET = withApiV1("events:read", async (ctx) => {
  const p = ctx.url.searchParams;
  const { items, nextCursor } = await listEvents(
    ctx.admin,
    ctx.workspaceId,
    parseLimit(p.get("limit")),
    p.get("cursor"),
  );
  return apiOk(items, { meta: { next_cursor: nextCursor } });
});
