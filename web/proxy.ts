import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

// Layer 1: single-user HTTP Basic Auth gate. Runs before anything else -
// nothing behind it (including the auth pages themselves) is reachable
// without the credential. Exists because Vercel's Hobby-plan Deployment
// Protection does not cover a project's production alias domain - see the
// V1 deployment report. Fails closed: if the expected credential isn't
// configured, every request is rejected rather than served unprotected.
// This is unrelated to - and stays in place alongside - the real
// Supabase Auth session handling below; it protects the deployment as a
// whole while the app has essentially one real user, and is a separate,
// later decision to remove once login is proven working end-to-end in
// production.

function unauthorized(): NextResponse {
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Personal Finance"' },
  });
}

function checkBasicAuth(request: NextRequest): NextResponse | null {
  const expectedUser = process.env.APP_BASIC_AUTH_USER;
  const expectedPassword = process.env.APP_BASIC_AUTH_PASSWORD;

  if (!expectedUser || !expectedPassword) {
    return new NextResponse("Access is not configured.", { status: 500 });
  }

  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Basic ")) {
    return unauthorized();
  }

  let decoded: string;
  try {
    decoded = atob(authHeader.slice("Basic ".length));
  } catch {
    return unauthorized();
  }

  const separatorIndex = decoded.indexOf(":");
  const user = decoded.slice(0, separatorIndex);
  const password = decoded.slice(separatorIndex + 1);

  if (user !== expectedUser || password !== expectedPassword) {
    return unauthorized();
  }

  return null;
}

// Layer 2: real Supabase Auth session. Public (no session required)
// routes are exactly the auth flow's own pages - everything else is a
// protected application route. This is server-side route protection
// (the actual boundary), never relied on as the only one - every
// workspace-scoped table also carries the RLS policies from
// 20260821000000_phase_b_identity_and_tenancy.sql as the real
// authorization backstop, so a route-protection bug here can misdirect a
// page but can never expose another workspace's data.
// Reachable without a session at all.
const PUBLIC_PATHS = [
  "/login",
  "/signup",
  "/auth/callback",
  "/auth/reset-password",
  // Must be reachable pre-auth: an invite recipient may not have an
  // account yet. The page itself bounces an unauthenticated visitor to
  // /login or /signup with ?next= pointing back here.
  "/invite",
];

// Of those, only these should redirect an already-signed-in user away -
// /auth/reset-password/confirm and /auth/callback must stay reachable
// even while signed in, since a password-reset flow *requires* the
// short-lived recovery session Supabase issues after the email link is
// clicked in order to actually set the new password.
const REDIRECT_IF_SIGNED_IN_PATHS = ["/login", "/signup"];

function matchesAny(pathname: string, paths: string[]): boolean {
  return paths.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export async function proxy(request: NextRequest) {
  const basicAuthFailure = checkBasicAuth(request);
  if (basicAuthFailure) {
    return basicAuthFailure;
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Always call getUser() (not getSession()) - it validates the token
  // against Supabase Auth rather than trusting whatever is in the cookie,
  // and this call is also what refreshes an expiring session.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;

  if (!user && !matchesAny(pathname, PUBLIC_PATHS)) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (user && matchesAny(pathname, REDIRECT_IF_SIGNED_IN_PATHS)) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return response;
}

export const config = {
  matcher: "/((?!_next/static|_next/image|favicon.ico).*)",
};
