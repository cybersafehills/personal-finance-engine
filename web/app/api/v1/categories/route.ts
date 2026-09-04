import { withApiV1 } from "../../../../lib/api/handler";
import { apiOk } from "../../../../lib/api/respond";
import { listCategories } from "../../../../lib/api/read-models";

// GET /api/v1/categories — scope categories:read. Workspace category set.
export const GET = withApiV1("categories:read", async (ctx) => {
  const items = await listCategories(ctx.admin, ctx.workspaceId);
  return apiOk(items);
});
