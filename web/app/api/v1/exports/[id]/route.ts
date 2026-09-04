import { withApiV1 } from "../../../../../lib/api/handler";
import { apiError, apiOk } from "../../../../../lib/api/respond";
import { getExportJob } from "../../../../../lib/api/read-models";

const SIGNED_URL_TTL_SECONDS = 300;

// GET /api/v1/exports/:id — scope exports:read. For a completed job with a
// stored file, includes a short-lived signed download URL (never the
// storage path itself).
export const GET = withApiV1("exports:read", async (ctx) => {
  const id = ctx.url.pathname.split("/").pop() ?? "";
  const result = await getExportJob(ctx.admin, ctx.workspaceId, id);
  if (!result) return apiError(404, "not_found", "No export with that id.");

  const body = result.row as Record<string, unknown>;
  const storagePath = result.job.storage_path as string | null;
  if (result.job.status === "completed" && storagePath) {
    const { data: signed } = await ctx.admin.storage
      .from("integration-exports")
      .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS, { download: true });
    if (signed?.signedUrl) {
      body.download_url = signed.signedUrl;
      body.download_url_expires_in = SIGNED_URL_TTL_SECONDS;
    }
  }
  return apiOk(body);
});
