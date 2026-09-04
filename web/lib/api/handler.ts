import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { hashToken } from "../credentials";
import { supabaseServer } from "../supabase-server";
import {
  isDeveloperApiConfigured,
  isDeveloperApiEnabled,
} from "../integrations/gate";
import { authenticateApiRequest } from "./authenticate";
import { type ApiScope, hasScope } from "./keys";
import { takeRateLimit } from "./rate-limit";
import { apiError } from "./respond";

// The shared /api/v1 wrapper. Every read endpoint is
//   withApiV1("<scope>", async (ctx) => apiOk(...))
// which runs, in order: deployment dark check -> bearer auth -> per-key
// enable check -> scope check -> rate limit -> the handler, and always
// writes one api_request_log row (never blocking the response).

export type ApiHandlerContext = {
  admin: SupabaseClient;
  workspaceId: string;
  keyId: string;
  scopes: string[];
  url: URL;
};

export function withApiV1(
  scope: ApiScope,
  handler: (ctx: ApiHandlerContext) => Promise<Response>,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const startedAt = Date.now();
    let status = 500;
    let workspaceId: string | null = null;
    let keyId: string | null = null;

    try {
      if (!isDeveloperApiConfigured()) {
        status = 404;
        return apiError(404, "not_found", "The developer API is not enabled.");
      }

      const auth = await authenticateApiRequest(request);
      if (!auth.ok) {
        status = auth.status;
        return apiError(auth.status, auth.code, auth.message, {
          "WWW-Authenticate": 'Bearer realm="OneLedger API"',
        });
      }
      workspaceId = auth.workspaceId;
      keyId = auth.keyId;

      if (!isDeveloperApiEnabled(auth.workspaceId)) {
        status = 404;
        return apiError(404, "not_found", "The developer API is not enabled.");
      }
      if (!hasScope(auth.scopes, scope)) {
        status = 403;
        return apiError(
          403,
          "insufficient_scope",
          `This API key does not have the "${scope}" scope.`,
        );
      }

      const rate = await takeRateLimit(auth.keyId);
      if (!rate.allowed) {
        status = 429;
        return apiError(429, "rate_limited", "Rate limit exceeded.", rate.headers);
      }

      const response = await handler({
        admin: supabaseServer(),
        workspaceId: auth.workspaceId,
        keyId: auth.keyId,
        scopes: auth.scopes,
        url: new URL(request.url),
      });
      status = response.status;
      for (const [k, v] of Object.entries(rate.headers)) {
        response.headers.set(k, v);
      }
      return response;
    } catch (err) {
      console.error("api/v1 handler error", err);
      status = 500;
      return apiError(500, "internal_error", "Something went wrong.");
    } finally {
      void logApiRequest(request, workspaceId, keyId, status, Date.now() - startedAt);
    }
  };
}

async function logApiRequest(
  request: Request,
  workspaceId: string | null,
  keyId: string | null,
  status: number,
  responseMs: number,
): Promise<void> {
  if (!workspaceId) return; // nothing tenant-scoped to attribute
  try {
    const admin = supabaseServer();
    const url = new URL(request.url);
    const rawIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    const ipHash = rawIp ? (await hashToken(rawIp)).slice(0, 16) : null;
    await admin.from("api_request_log").insert({
      api_key_id: keyId,
      workspace_id: workspaceId,
      method: request.method,
      path: url.pathname,
      status,
      ip_hash: ipHash,
      response_ms: responseMs,
    });
  } catch {
    // request logging must never break a response
  }
}
