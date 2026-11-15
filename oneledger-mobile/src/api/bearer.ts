import { supabase } from "@/api/supabase";
import { config } from "@/lib/config";

// GET helper for the web app's bearer-authenticated, read-only /api/mobile
// endpoints (inbox, budgets). Sends the user's own Supabase access token; the
// server validates it and runs everything under RLS (docs/mobile-api.md).

export type BearerResponse =
  | { kind: "response"; status: number; body: unknown }
  /** No session, no API base configured, or the network failed. */
  | { kind: "no_session" }
  | { kind: "unconfigured" }
  | { kind: "network" };

export async function bearerGet(path: string): Promise<BearerResponse> {
  if (!supabase || !config.apiBaseUrl) return { kind: "unconfigured" };
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { kind: "no_session" };

  let response: Response;
  try {
    response = await fetch(`${config.apiBaseUrl}${path}`, {
      headers: { authorization: `Bearer ${token}` },
    });
  } catch {
    return { kind: "network" };
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Non-JSON error page; the status alone decides.
  }
  return { kind: "response", status: response.status, body };
}

export type BearerFailure = {
  /** `unavailable`: the endpoint is off or the app isn't configured. */
  reason: "unavailable" | "unauthorized" | "mfa_required" | "error";
  message: string;
};

/** Maps a non-success HTTP status to something the screen can act on. */
export function failureForStatus(status: number, what: string): BearerFailure {
  if (status === 404) {
    return { reason: "unavailable", message: `${what} isn't available yet.` };
  }
  if (status === 401) return { reason: "unauthorized", message: "Please sign in again." };
  if (status === 403) {
    return {
      reason: "mfa_required",
      message: `Finish two-step verification to see ${what.toLowerCase()}.`,
    };
  }
  return {
    reason: "error",
    message: `Couldn't load ${what.toLowerCase()}. Check your connection and try again.`,
  };
}

/** Failure for the non-response outcomes of bearerGet. */
export function failureForOutcome(
  outcome: Exclude<BearerResponse, { kind: "response" }>,
  what: string,
): BearerFailure {
  switch (outcome.kind) {
    case "unconfigured":
      return { reason: "unavailable", message: `${what} isn't available yet.` };
    case "no_session":
      return { reason: "unauthorized", message: "Please sign in again." };
    case "network":
      return {
        reason: "error",
        message: `Couldn't load ${what.toLowerCase()}. Check your connection and try again.`,
      };
  }
}
