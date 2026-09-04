import { withApiV1 } from "../../../../../lib/api/handler";
import { apiError, apiOk } from "../../../../../lib/api/respond";
import { getTransaction } from "../../../../../lib/api/read-models";

// GET /api/v1/transactions/:id — scope transactions:read.
export const GET = withApiV1("transactions:read", async (ctx) => {
  const id = ctx.url.pathname.split("/").pop() ?? "";
  const row = await getTransaction(ctx.admin, ctx.workspaceId, id);
  if (!row) return apiError(404, "not_found", "No transaction with that id.");
  return apiOk(row);
});
