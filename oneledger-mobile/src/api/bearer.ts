import { supabase } from "@/api/supabase";
import { config } from "@/lib/config";
import { getRequestedWorkspace } from "@/features/spaces/request-space";
import { echoMatches } from "@/features/spaces/spaces";

// GET/POST helpers for the web app's bearer-authenticated /api/mobile
// endpoints (inbox, budgets, pay, ...). Sends the user's own Supabase access token; the
// server validates it and runs everything under RLS (docs/mobile-api.md).

export type BearerResponse =
  | { kind: "response"; status: number; body: unknown }
  /** No session, no API base configured, or the network failed. */
  | { kind: "no_session" }
  | { kind: "unconfigured" }
  /** The server did not confirm the requested Space (older server, or access revoked). */
  | { kind: "space_unsupported" }
  | { kind: "network" };

async function bearerRequest(path: string, init: RequestInit = {}): Promise<BearerResponse> {
  if (!supabase || !config.apiBaseUrl) return { kind: "unconfigured" };
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { kind: "no_session" };
  // Personal (the server default) sends no header.
  const workspaceId = getRequestedWorkspace();

  let response: Response;
  const controller=new AbortController();
  const timeout=init.signal?undefined:setTimeout(()=>controller.abort(),30000);
  try {
    response = await fetch(`${config.apiBaseUrl}${path}`, {
      ...init,
      signal:init.signal??controller.signal,
      headers: {
        ...(init.headers as Record<string, string> | undefined),
        authorization: `Bearer ${token}`,
        ...(workspaceId ? { "x-workspace-id": workspaceId } : {}),
      },
    });
  } catch {
    return { kind: "network" };
  } finally { if(timeout)clearTimeout(timeout); }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Non-JSON error page; the status alone decides.
  }
  if (response.status === 200 && !echoMatches(workspaceId, body)) {
    return { kind: "space_unsupported" };
  }
  return { kind: "response", status: response.status, body };
}

export function bearerGet(path: string,signal?:AbortSignal): Promise<BearerResponse> {
  return bearerRequest(path,{signal});
}

/** POST a JSON body with the user's own token (the server runs it under RLS, second factor required). */
export function bearerPost(path: string, body: unknown,signal?:AbortSignal): Promise<BearerResponse> {
  return bearerRequest(path, {
    method: "POST",
    signal,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
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
    case "space_unsupported":
      return {
        reason: "unavailable",
        message: `${what} can't be shown for this Space yet.`,
      };
    case "network":
      return {
        reason: "error",
        message: `Couldn't load ${what.toLowerCase()}. Check your connection and try again.`,
      };
  }
}
