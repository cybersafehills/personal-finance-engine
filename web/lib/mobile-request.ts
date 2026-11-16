import "server-only";
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

import {
  bearerToken,
  corsHeadersFor,
  isMobileApiEnabled,
  mfaSatisfied,
  mobileAuthRateLimited,
  tokenAal,
  workspaceIdFromHeader,
} from "./mobile-api";
import { getActiveWorkspaceId } from "./queries";
import { runWithMobileSession } from "./mobile-session-context";

// The shared guard for bearer-authenticated, read-only mobile endpoints
// (GET /api/mobile/inbox, /budgets, ...; docs/mobile-api.md). In order:
// dark unless MOBILE_API_ENABLED === "true" -> per-IP limit -> bearer token ->
// validated with Supabase Auth (getUser, not just decoded) -> second factor
// complete when the user has one -> the handler runs under that token, so the
// ordinary read models execute as the user under RLS. Never logs the token or
// the response; every response is `no-store`.

const METHODS = "GET, OPTIONS";

function cors(request: NextRequest) {
  return corsHeadersFor(
    request.headers.get("origin"),
    process.env.MOBILE_API_CORS_ORIGINS,
    METHODS,
  );
}

function json(request: NextRequest, body: unknown, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store", ...cors(request) },
  });
}

export function mobileOptions(request: NextRequest) {
  if (!isMobileApiEnabled(process.env.MOBILE_API_ENABLED)) {
    return new NextResponse(null, { status: 404 });
  }
  return new NextResponse(null, { status: 204, headers: cors(request) });
}

/** `name` keys the rate limiter so one endpoint cannot starve another. */
export async function mobileGet(
  request: NextRequest,
  name: string,
  handler: () => Promise<Record<string, unknown>>,
): Promise<NextResponse> {
  if (!isMobileApiEnabled(process.env.MOBILE_API_ENABLED)) {
    return json(request, { ok: false, error: "not_found" }, 404);
  }

  const ip = (request.headers.get("x-forwarded-for") ?? "").split(",")[0]
    .trim() || "unknown";
  if (mobileAuthRateLimited(`${name}:${ip}`, Date.now(), 60)) {
    return json(request, { ok: false, error: "rate_limited" }, 429);
  }

  const token = bearerToken(request.headers.get("authorization"));
  if (!token) return json(request, { ok: false, error: "unauthorized" }, 401);

  const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data, error } = await anon.auth.getUser(token);
  if (error || !data.user) {
    return json(request, { ok: false, error: "unauthorized" }, 401);
  }
  if (!mfaSatisfied(tokenAal(token), data.user.factors)) {
    return json(request, { ok: false, error: "mfa_required" }, 403);
  }

  try {
    // The Space the app is viewing. Only a request: getActiveWorkspaceId()
    // checks membership and falls back to the personal Space.
    const requested = workspaceIdFromHeader(request.headers.get("x-workspace-id"));
    const body = await runWithMobileSession(token, async () => {
      const out = await handler();
      // Echo the Space actually used, so an app talking to a server that
      // ignores the header (or a revoked membership) can tell.
      return requested
        ? { ...out, workspace_id: await getActiveWorkspaceId() }
        : out;
    }, requested);
    return json(request, { ok: true, ...body }, 200);
  } catch {
    return json(request, { ok: false, error: "server_error" }, 500);
  }
}
