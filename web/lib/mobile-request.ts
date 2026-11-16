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
  tokenIsFresh,
} from "./mobile-api";
import { runWithMobileSession } from "./mobile-session-context";

// The shared guard for bearer-authenticated, read-only mobile endpoints
// (GET /api/mobile/inbox, /budgets, ...; docs/mobile-api.md). In order:
// dark unless MOBILE_API_ENABLED === "true" -> per-IP limit -> bearer token ->
// validated with Supabase Auth (getUser, not just decoded) -> second factor
// complete when the user has one -> the handler runs under that token, so the
// ordinary read models execute as the user under RLS. Never logs the token or
// the response; every response is `no-store`.

const GET_METHODS = "GET, OPTIONS";
const POST_METHODS = "GET, POST, OPTIONS";

function cors(request: NextRequest, methods: string = GET_METHODS) {
  return corsHeadersFor(
    request.headers.get("origin"),
    process.env.MOBILE_API_CORS_ORIGINS,
    methods,
  );
}

function json(
  request: NextRequest,
  body: unknown,
  status: number,
  methods: string = GET_METHODS,
) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store", ...cors(request, methods) },
  });
}

export function mobileOptions(request: NextRequest) {
  if (!isMobileApiEnabled(process.env.MOBILE_API_ENABLED)) {
    return new NextResponse(null, { status: 404 });
  }
  return new NextResponse(null, { status: 204, headers: cors(request) });
}

/** OPTIONS for a route that also accepts POST. */
export function mobilePostOptions(request: NextRequest) {
  if (!isMobileApiEnabled(process.env.MOBILE_API_ENABLED)) {
    return new NextResponse(null, { status: 404 });
  }
  return new NextResponse(null, {
    status: 204,
    headers: cors(request, POST_METHODS),
  });
}

type Authenticated =
  | { ok: true; token: string; userId: string }
  | { ok: false; response: NextResponse };

// The one authentication path shared by GET and POST: flag -> per-IP limit ->
// bearer token validated with Supabase Auth -> second factor complete when the
// user has one. A completed second factor here is exactly the web's
// requireMfaForSensitiveAction (a user with a verified factor must be aal2), so
// a mobile mutation is never weaker than its server action.
async function authenticate(
  request: NextRequest,
  name: string,
  limitPerMinute: number,
  methods: string,
): Promise<Authenticated> {
  const fail = (body: Record<string, unknown>, status: number) => ({
    ok: false as const,
    response: json(request, body, status, methods),
  });

  if (!isMobileApiEnabled(process.env.MOBILE_API_ENABLED)) {
    return fail({ ok: false, error: "not_found" }, 404);
  }

  const ip = (request.headers.get("x-forwarded-for") ?? "").split(",")[0]
    .trim() || "unknown";
  if (mobileAuthRateLimited(`${name}:${ip}`, Date.now(), limitPerMinute)) {
    return fail({ ok: false, error: "rate_limited" }, 429);
  }

  const token = bearerToken(request.headers.get("authorization"));
  if (!token) return fail({ ok: false, error: "unauthorized" }, 401);

  const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data, error } = await anon.auth.getUser(token);
  if (error || !data.user) return fail({ ok: false, error: "unauthorized" }, 401);
  if (!mfaSatisfied(tokenAal(token), data.user.factors)) {
    return fail({ ok: false, error: "mfa_required" }, 403);
  }
  return { ok: true, token, userId: data.user.id };
}

/** Whether the caller's access token is recent enough to count as a fresh sign-in. */
export function mobileSessionFresh(token: string, maxMinutes: number): boolean {
  return tokenIsFresh(token, maxMinutes);
}

/** Thrown by a POST handler to answer with a specific status and code. */
export class MobileApiError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409 | 413 | 422,
    readonly code: string,
    /** A safe, user-facing sentence (never raw database text); defaults to the code. */
    message: string = code,
  ) {
    super(message);
  }
}

const MAX_BODY_BYTES = 8 * 1024;

export type MobilePostContext = {
  userId: string;
  /** The validated access token (never log it). */
  token: string;
};

/**
 * Guard for a bearer-authenticated mutation. Same checks as `mobileGet`, a
 * stricter per-IP limit, and a small JSON body. The handler runs under the
 * caller's token (RLS is still the boundary) and may throw `MobileApiError`
 * for a specific status. Never logs the token, the body or the response.
 */
export async function mobilePost(
  request: NextRequest,
  name: string,
  handler: (
    body: unknown,
    ctx: MobilePostContext,
  ) => Promise<Record<string, unknown>>,
): Promise<NextResponse> {
  const auth = await authenticate(request, name, 20, POST_METHODS);
  if (!auth.ok) return auth.response;

  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) {
    return json(request, { ok: false, error: "too_large" }, 413, POST_METHODS);
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json(request, { ok: false, error: "invalid_request" }, 400, POST_METHODS);
  }

  try {
    const out = await runWithMobileSession(
      auth.token,
      () => handler(body, { userId: auth.userId, token: auth.token }),
    );
    return json(request, { ok: true, ...out }, 200, POST_METHODS);
  } catch (err) {
    if (err instanceof MobileApiError) {
      return json(
        request,
        { ok: false, error: err.code, message: err.message },
        err.status,
        POST_METHODS,
      );
    }
    return json(request, { ok: false, error: "server_error" }, 500, POST_METHODS);
  }
}

/** `name` keys the rate limiter so one endpoint cannot starve another. */
export async function mobileGet(
  request: NextRequest,
  name: string,
  handler: () => Promise<Record<string, unknown>>,
): Promise<NextResponse> {
  const auth = await authenticate(request, name, 60, GET_METHODS);
  if (!auth.ok) return auth.response;

  try {
    const body = await runWithMobileSession(auth.token, handler);
    return json(request, { ok: true, ...body }, 200);
  } catch (err) {
    // A read handler may refuse with a specific status (flag off -> 404, bad
    // input -> 400, ...), exactly as a mutation can.
    if (err instanceof MobileApiError) {
      return json(request, { ok: false, error: err.code, message: err.message }, err.status);
    }
    return json(request, { ok: false, error: "server_error" }, 500);
  }
}
