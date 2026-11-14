import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

import { passwordSignIn } from "../../../../../lib/auth/password-sign-in";
import {
  allowedCorsOrigin,
  isMobileApiEnabled,
  mobileAuthRateLimited,
  parseSignInBody,
} from "../../../../../lib/mobile-api";

// POST /api/mobile/auth/sign-in — password sign-in for the OneLedger mobile
// app (ADR 0019). Runs the SAME lockout / attempt log / security emails as
// the web login (lib/auth/password-sign-in.ts) and returns the Supabase
// session tokens in the body instead of setting cookies; the app stores
// them in the device keystore and talks to Supabase under RLS from then on.
//
// No session required (excluded from the gate in web/proxy.ts). Dark (404)
// unless MOBILE_API_ENABLED === "true". Never logs the body.

function corsHeaders(request: NextRequest): Record<string, string> {
  const origin = allowedCorsOrigin(
    request.headers.get("origin"),
    process.env.MOBILE_API_CORS_ORIGINS,
  );
  if (!origin) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Vary": "Origin",
  };
}

function json(
  request: NextRequest,
  body: Record<string, unknown>,
  status: number,
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store", ...corsHeaders(request) },
  });
}

export function OPTIONS(request: NextRequest) {
  if (!isMobileApiEnabled(process.env.MOBILE_API_ENABLED)) {
    return new NextResponse(null, { status: 404 });
  }
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) });
}

export async function POST(request: NextRequest) {
  if (!isMobileApiEnabled(process.env.MOBILE_API_ENABLED)) {
    return json(request, { ok: false, error: "not_found" }, 404);
  }

  const ip = (request.headers.get("x-forwarded-for") ?? "").split(",")[0]
    .trim() || "unknown";
  if (mobileAuthRateLimited(ip)) {
    return json(request, {
      ok: false,
      error: "rate_limited",
      message: "Too many attempts. Try again in a minute.",
    }, 429);
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    raw = null;
  }
  const body = parseSignInBody(raw);
  if (!body) {
    return json(request, {
      ok: false,
      error: "invalid_request",
      message: "Enter your email and password.",
    }, 400);
  }

  // A throwaway anon client: the session it obtains is returned to the
  // caller and never persisted or refreshed on the server.
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const result = await passwordSignIn(client, body.email, body.password);
  if (!result.ok) {
    return json(request, {
      ok: false,
      error: result.lockedOut ? "locked_out" : "invalid_credentials",
      message: result.error,
    }, result.lockedOut ? 429 : 401);
  }
  if (!result.session) {
    return json(request, {
      ok: false,
      error: "no_session",
      message: "Sign-in did not complete. Try again.",
    }, 502);
  }

  return json(request, {
    ok: true,
    access_token: result.session.access_token,
    refresh_token: result.session.refresh_token,
    mfa_required: result.mfaRequired,
  }, 200);
}
