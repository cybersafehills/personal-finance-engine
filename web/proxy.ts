import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

// The domain-wide HTTP Basic Auth gate that used to sit here (Layer 1)
// is retired as of the auth-hardening work in commits 9acd6fd, 0286505,
// 084c937, 3eb31b7: per-account login lockout, /settings/security,
// organization workspaces/invites, and Resend-backed transactional
// email are all live and were walked through end-to-end on the real
// oneledger.me domain first. Real Supabase Auth session handling (below)
// plus the RLS policies in 20260821000000_phase_b_identity_and_tenancy.sql
// are now the sole boundary, as originally designed.

// Real Supabase Auth session. Public (no session required)
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
  // /api/cron/* is excluded: those routes authenticate via their own
  // shared-secret header (isAuthorizedCronRequest, cron-auth.ts), never
  // via a browser session - pg_cron/curl never carry a Supabase session
  // cookie, so leaving them subject to this session gate meant every
  // cron call was redirected to /login before the route handler's own
  // secret check ever ran (discovered via a manual curl smoke test
  // returning a 307 to /login instead of reaching the route).
  //
  // /brand/* is excluded: it is nothing but static public brand artwork
  // (logo, mark, favicons, and the iOS PWA launch images). Gating it did
  // no security work - the files are world-readable in public/ - but it
  // did 307 every one of those images to /login for a logged-out
  // visitor, so an installed iOS PWA never got its apple-touch-startup-
  // image and fell back to a black launch screen.
  matcher:
    "/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|api/cron|brand/).*)",
};
