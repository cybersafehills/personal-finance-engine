import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

// Lets the mobile API (app/api/mobile/*) run the ordinary read models under
// the caller's bearer token instead of a cookie. supabaseSession() consults
// this; outside a mobile request the store is empty and behaviour is exactly
// the cookie-based web behaviour. The token is validated by the route before
// it is stored here, and every query still runs as that user under RLS.
const store = new AsyncLocalStorage<{ accessToken: string; workspaceId: string | null }>();

export function runWithMobileSession<T>(
  accessToken: string,
  fn: () => Promise<T>,
  workspaceId: string | null = null,
): Promise<T> {
  return store.run({ accessToken, workspaceId }, fn);
}

export function mobileAccessToken(): string | null {
  return store.getStore()?.accessToken ?? null;
}

/**
 * The Space the app asked for (`X-Workspace-Id`), or null. A *request*, not a
 * grant: `getActiveWorkspaceId` still checks active membership and falls back
 * to the personal Space, the same as it does for the web's cookie.
 */
export function mobileRequestedWorkspaceId(): string | null {
  return store.getStore()?.workspaceId ?? null;
}
