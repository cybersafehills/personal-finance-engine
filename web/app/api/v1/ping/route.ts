import { authenticateApiRequest } from "../../../../lib/api/authenticate";
import { apiError, apiOk } from "../../../../lib/api/respond";
import {
  isDeveloperApiConfigured,
  isDeveloperApiEnabled,
} from "../../../../lib/integrations/gate";

// GET /api/v1/ping — the smallest authenticated endpoint. Confirms the
// key is valid and echoes the workspace + granted scopes. No scope of its
// own. Dark (404) unless INTEGRATIONS_DEVELOPER_API_ENABLED === "true".
// Excluded from the app session gate in web/proxy.ts; this handler does
// its own bearer auth.

export async function GET(request: Request) {
  if (!isDeveloperApiConfigured()) {
    return apiError(404, "not_found", "The developer API is not enabled.");
  }

  const auth = await authenticateApiRequest(request);
  if (!auth.ok) {
    return apiError(auth.status, auth.code, auth.message, {
      "WWW-Authenticate": 'Bearer realm="OneLedger API"',
    });
  }

  if (!isDeveloperApiEnabled(auth.workspaceId)) {
    return apiError(404, "not_found", "The developer API is not enabled.");
  }

  return apiOk({
    ok: true,
    workspace_id: auth.workspaceId,
    scopes: auth.scopes,
  });
}
