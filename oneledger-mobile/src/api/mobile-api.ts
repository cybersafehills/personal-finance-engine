import { supabase } from "@/api/supabase";
import { parseInboxResponse, type InboxResult } from "@/features/inbox/parse";
import { config } from "@/lib/config";

// Client for the web app's /api/mobile/* endpoints (ADR 0019): operations
// that must run on the server (sign-in lockout and security emails now,
// MFA-gated mutations later).

export type SignInResponse =
  | {
      ok: true;
      accessToken: string;
      refreshToken: string;
      mfaRequired: boolean;
    }
  | { ok: false; message: string };

const GENERIC_ERROR = "Couldn't sign in. Check your connection and try again.";

/** Maps the endpoint's JSON to a typed result. Exported for tests. */
export function parseSignInResponse(
  status: number,
  body: unknown,
): SignInResponse {
  const data =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : {};

  if (
    status === 200 &&
    data.ok === true &&
    typeof data.access_token === "string" &&
    typeof data.refresh_token === "string"
  ) {
    return {
      ok: true,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      mfaRequired: data.mfa_required === true,
    };
  }

  if (status === 404) {
    return {
      ok: false,
      message: "Sign-in from the app isn't available yet.",
    };
  }

  return {
    ok: false,
    message: typeof data.message === "string" ? data.message : GENERIC_ERROR,
  };
}

export async function signInWithPassword(
  email: string,
  password: string,
): Promise<SignInResponse> {
  let response: Response;
  try {
    response = await fetch(`${config.apiBaseUrl}/api/mobile/auth/sign-in`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    return { ok: false, message: GENERIC_ERROR };
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Non-JSON error page; fall through to the generic message.
  }
  return parseSignInResponse(response.status, body);
}

/**
 * The full prioritized Inbox, computed by the web app (it owns the feature
 * flags and the cross-domain read models). Sends the user's own Supabase
 * access token; the server validates it and runs everything under RLS.
 */
export async function fetchInbox(): Promise<InboxResult> {
  if (!supabase || !config.apiBaseUrl) {
    return { ok: false, reason: "unavailable", message: "The full inbox isn't available yet." };
  }
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { ok: false, reason: "unauthorized", message: "Please sign in again." };

  let response: Response;
  try {
    response = await fetch(`${config.apiBaseUrl}/api/mobile/inbox`, {
      headers: { authorization: `Bearer ${token}` },
    });
  } catch {
    return {
      ok: false,
      reason: "error",
      message: "Couldn't load your inbox. Check your connection and try again.",
    };
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Non-JSON error page; the status alone decides.
  }
  return parseInboxResponse(response.status, body);
}
