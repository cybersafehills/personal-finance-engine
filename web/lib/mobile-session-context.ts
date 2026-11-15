import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

// Lets the mobile API (app/api/mobile/*) run the ordinary read models under
// the caller's bearer token instead of a cookie. supabaseSession() consults
// this; outside a mobile request the store is empty and behaviour is exactly
// the cookie-based web behaviour. The token is validated by the route before
// it is stored here, and every query still runs as that user under RLS.
const store = new AsyncLocalStorage<{ accessToken: string }>();

export function runWithMobileSession<T>(accessToken: string, fn: () => Promise<T>): Promise<T> {
  return store.run({ accessToken }, fn);
}

export function mobileAccessToken(): string | null {
  return store.getStore()?.accessToken ?? null;
}
