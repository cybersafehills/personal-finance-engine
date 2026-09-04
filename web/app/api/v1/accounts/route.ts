import { withApiV1 } from "../../../../lib/api/handler";
import { apiOk } from "../../../../lib/api/respond";
import { listAccounts } from "../../../../lib/api/read-models";

// GET /api/v1/accounts — scope accounts:read. Small set, unpaginated.
export const GET = withApiV1("accounts:read", async (ctx) => {
  const items = await listAccounts(ctx.admin, ctx.workspaceId);
  return apiOk(items);
});
