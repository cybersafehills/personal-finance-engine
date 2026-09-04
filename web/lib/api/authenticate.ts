import "server-only";

import { hashToken } from "../credentials";
import { supabaseServer } from "../supabase-server";
import { bearerFromHeader, looksLikeApiKey } from "./keys";

// Bearer-token authentication for /api/v1. There is no Supabase session
// here: an `Authorization: Bearer olk_...` token is SHA-256 hashed and
// matched against api_keys.key_hash with the service-role client. On
// success the caller gets the key's workspace_id + scopes; every read
// downstream is done with the service-role client PINNED to that
// workspace_id (the "service-role resolves explicit tenant scope"
// invariant), never a session.

export type ApiAuthContext = {
  ok: true;
  keyId: string;
  workspaceId: string;
  scopes: string[];
};

export type ApiAuthFailure = {
  ok: false;
  status: 401;
  code:
    | "missing_bearer"
    | "invalid_key"
    | "key_revoked"
    | "key_expired";
  message: string;
};

const LAST_USED_THROTTLE_MS = 60_000;

export async function authenticateApiRequest(
  request: Request,
): Promise<ApiAuthContext | ApiAuthFailure> {
  const token = bearerFromHeader(request.headers.get("authorization"));
  if (!token) {
    return {
      ok: false,
      status: 401,
      code: "missing_bearer",
      message: "Provide an API key as a Bearer token.",
    };
  }
  if (!looksLikeApiKey(token)) {
    return {
      ok: false,
      status: 401,
      code: "invalid_key",
      message: "That API key is not recognised.",
    };
  }

  const keyHash = await hashToken(token);
  const admin = supabaseServer();
  const { data: key, error } = await admin
    .from("api_keys")
    .select("id, workspace_id, scopes, status, expires_at, last_used_at")
    .eq("key_hash", keyHash)
    .maybeSingle();
  if (error || !key) {
    return {
      ok: false,
      status: 401,
      code: "invalid_key",
      message: "That API key is not recognised.",
    };
  }
  if (key.status !== "active") {
    return {
      ok: false,
      status: 401,
      code: "key_revoked",
      message: "That API key has been revoked.",
    };
  }
  if (key.expires_at && new Date(key.expires_at as string).getTime() < Date.now()) {
    return {
      ok: false,
      status: 401,
      code: "key_expired",
      message: "That API key has expired.",
    };
  }

  // Throttled last_used_at bump - at most once per minute per key, and
  // never blocking the response.
  const lastUsed = key.last_used_at
    ? new Date(key.last_used_at as string).getTime()
    : 0;
  if (Date.now() - lastUsed > LAST_USED_THROTTLE_MS) {
    void admin
      .from("api_keys")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", key.id)
      .then(() => {}, () => {});
  }

  return {
    ok: true,
    keyId: key.id as string,
    workspaceId: key.workspace_id as string,
    scopes: (key.scopes ?? []) as string[],
  };
}
