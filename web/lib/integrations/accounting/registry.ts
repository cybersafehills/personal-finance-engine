import "server-only";

import {
  ACCOUNTING_PROVIDER_META,
  type AccountingAdapter,
  AccountingProviderNotConfiguredError,
  type AccountingProviderKey,
  type OAuthTokenSet,
} from "./contract.ts";

// Server-only registry. A provider is CONFIGURED only when both its
// *_CLIENT_ID and *_SECRET env vars are present. An unconfigured provider
// yields an adapter whose every method throws
// AccountingProviderNotConfiguredError - the OAuth routes turn that into a
// 501, and a sync run records it as a `partial` outcome. A CONFIGURED
// provider gets a real OAuth authUrl/exchange/refresh, but
// listAccounts/pushEntries/getRevision still throw
// `provider_push_not_implemented` until a specific provider is built out
// end to end - we never pretend a push succeeded.

type ProviderEnv = { clientId: string; clientSecret: string };

function providerEnv(key: AccountingProviderKey): ProviderEnv | null {
  const meta = ACCOUNTING_PROVIDER_META[key];
  const clientId = process.env[meta.clientIdEnv]?.trim();
  const clientSecret = process.env[meta.clientSecretEnv]?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export function isAccountingProviderConfigured(
  key: AccountingProviderKey,
): boolean {
  return providerEnv(key) !== null;
}

export function configuredAccountingProviders(): AccountingProviderKey[] {
  return (Object.keys(ACCOUNTING_PROVIDER_META) as AccountingProviderKey[])
    .filter(isAccountingProviderConfigured);
}

function unconfiguredAdapter(key: AccountingProviderKey): AccountingAdapter {
  const fail = (): never => {
    throw new AccountingProviderNotConfiguredError(key);
  };
  return {
    provider: key,
    authUrl: fail,
    exchangeCode: fail,
    refresh: fail,
    listAccounts: fail,
    pushEntries: fail,
    getRevision: fail,
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function normalizeTokenResponse(json: any): OAuthTokenSet {
  const expiresIn = Number(json.expires_in);
  return {
    accessToken: String(json.access_token ?? ""),
    refreshToken: json.refresh_token ? String(json.refresh_token) : null,
    expiresAt: Number.isFinite(expiresIn)
      ? new Date(Date.now() + expiresIn * 1000).toISOString()
      : null,
    scope: json.scope ? String(json.scope) : null,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function configuredAdapter(
  key: AccountingProviderKey,
  env: ProviderEnv,
): AccountingAdapter {
  const meta = ACCOUNTING_PROVIDER_META[key];

  return {
    provider: key,
    authUrl({ redirectUri, state, codeChallenge }) {
      const u = new URL(meta.authUrl);
      u.searchParams.set("client_id", env.clientId);
      u.searchParams.set("redirect_uri", redirectUri);
      u.searchParams.set("response_type", "code");
      u.searchParams.set("scope", meta.scopes.join(" "));
      u.searchParams.set("state", state);
      if (meta.usesPkce && codeChallenge) {
        u.searchParams.set("code_challenge", codeChallenge);
        u.searchParams.set("code_challenge_method", "S256");
      }
      return u.toString();
    },
    async exchangeCode({ code, redirectUri, codeVerifier }) {
      const body = new URLSearchParams({
        client_id: env.clientId,
        client_secret: env.clientSecret,
        code,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      });
      if (codeVerifier) body.set("code_verifier", codeVerifier);
      const res = await fetch(meta.tokenUrl, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`token exchange failed (${res.status})`);
      return normalizeTokenResponse(await res.json());
    },
    async refresh(refreshToken) {
      const res = await fetch(meta.tokenUrl, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: env.clientId,
          client_secret: env.clientSecret,
          refresh_token: refreshToken,
          grant_type: "refresh_token",
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`token refresh failed (${res.status})`);
      return normalizeTokenResponse(await res.json());
    },
    listAccounts() {
      throw new Error("provider_push_not_implemented");
    },
    pushEntries() {
      throw new Error("provider_push_not_implemented");
    },
    getRevision() {
      throw new Error("provider_push_not_implemented");
    },
  };
}

export function getAccountingAdapter(
  key: AccountingProviderKey,
): AccountingAdapter {
  const env = providerEnv(key);
  return env ? configuredAdapter(key, env) : unconfiguredAdapter(key);
}
