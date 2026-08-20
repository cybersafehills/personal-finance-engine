import { type NextRequest, NextResponse } from "next/server";

// Single-user HTTP Basic Auth gate. Runs before any page or data request -
// nothing behind it (including the server-only Supabase-backed pages) is
// reachable without the credential. Exists because Vercel's Hobby-plan
// Deployment Protection does not cover a project's production alias
// domain (only the raw per-deployment URL and Preview deployments) - see
// the deployment report for the full finding. Fails closed: if the
// expected credential isn't configured, every request is rejected rather
// than served unprotected.

function unauthorized(): NextResponse {
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Personal Finance"' },
  });
}

export function middleware(request: NextRequest) {
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

  return NextResponse.next();
}

export const config = {
  matcher: "/((?!_next/static|_next/image|favicon.ico).*)",
};
