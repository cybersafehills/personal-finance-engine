import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

import { getFinancialInbox } from "../../../../lib/financial-inbox";
import {
  bearerToken,
  corsHeadersFor,
  isMobileApiEnabled,
  mfaSatisfied,
  mobileAuthRateLimited,
  tokenAal,
} from "../../../../lib/mobile-api";
import { runWithMobileSession } from "../../../../lib/mobile-session-context";

// GET /api/mobile/inbox - the same prioritized Inbox the web renders
// (lib/financial-inbox.ts), for the mobile app (ADR 0019). The app sends its
// Supabase access token; this validates it with Supabase Auth, requires the
// second factor to be complete when the user has one, then runs the ordinary
// read model under that token so Row Level Security stays the boundary and
// the feature-flag gating (payments, integrations, bills) stays server-side.
//
// Read-only. Dark (404) unless MOBILE_API_ENABLED === "true". No session
// cookie involved (excluded from the gate in web/proxy.ts). Never logs the
// token or the response.

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

export function OPTIONS(request: NextRequest) {
  if (!isMobileApiEnabled(process.env.MOBILE_API_ENABLED)) {
    return new NextResponse(null, { status: 404 });
  }
  return new NextResponse(null, { status: 204, headers: cors(request) });
}

export async function GET(request: NextRequest) {
  if (!isMobileApiEnabled(process.env.MOBILE_API_ENABLED)) {
    return json(request, { ok: false, error: "not_found" }, 404);
  }

  const ip = (request.headers.get("x-forwarded-for") ?? "").split(",")[0]
    .trim() || "unknown";
  if (mobileAuthRateLimited(`inbox:${ip}`, Date.now(), 60)) {
    return json(request, { ok: false, error: "rate_limited" }, 429);
  }

  const token = bearerToken(request.headers.get("authorization"));
  if (!token) {
    return json(request, { ok: false, error: "unauthorized" }, 401);
  }

  // Validate the token with Supabase Auth (not just decode it).
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
    const inbox = await runWithMobileSession(token, () => getFinancialInbox());
    return json(request, { ok: true, inbox }, 200);
  } catch {
    return json(request, { ok: false, error: "server_error" }, 500);
  }
}
