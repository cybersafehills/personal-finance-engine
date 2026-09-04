import { withApiV1 } from "../../../../lib/api/handler";
import { apiOk, parseLimit } from "../../../../lib/api/respond";
import { listTransactions } from "../../../../lib/api/read-models";

// GET /api/v1/transactions
//   ?from &to (ISO) &account_id &direction=in|out|neutral &category
//   &limit (<=200) &cursor
// Scope: transactions:read. Excludes merged duplicates.
export const GET = withApiV1("transactions:read", async (ctx) => {
  const p = ctx.url.searchParams;
  const dir = p.get("direction");
  const { items, nextCursor } = await listTransactions(
    ctx.admin,
    ctx.workspaceId,
    {
      from: p.get("from") ?? undefined,
      to: p.get("to") ?? undefined,
      accountId: p.get("account_id") ?? undefined,
      direction: dir === "in" || dir === "out" || dir === "neutral"
        ? dir
        : undefined,
      category: p.get("category") ?? undefined,
    },
    parseLimit(p.get("limit")),
    p.get("cursor"),
  );
  return apiOk(items, { meta: { next_cursor: nextCursor } });
});
