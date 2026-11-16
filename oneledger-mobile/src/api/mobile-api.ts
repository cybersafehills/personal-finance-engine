import { bearerGet, failureForOutcome } from "@/api/bearer";
import { parseBudgetsResponse, type BudgetsResult } from "@/features/budgets/parse";
import { parseInboxResponse, type InboxResult } from "@/features/inbox/parse";
import {
  parseDrilldownResponse,
  parseInsightsResponse,
  type DrilldownResult,
  type InsightsResult,
} from "@/features/insights/parse";
import type { Drilldown } from "@/features/insights/types";
import {
  parsePeopleResponse,
  parsePersonResponse,
  type PeopleResult,
  type PersonResult,
} from "@/features/people/parse";
import type { PersonKind } from "@/features/people/types";
import { parseWalletsResponse, type WalletsResult } from "@/features/wallets/parse";
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
  const result = await bearerGet("/api/mobile/inbox");
  if (result.kind !== "response") {
    return { ok: false, ...failureForOutcome(result, "The full inbox") };
  }
  return parseInboxResponse(result.status, result.body);
}

/** Active budgets with their actuals, from the web's canonical budget maths. */
export async function fetchBudgets(): Promise<BudgetsResult> {
  const result = await bearerGet("/api/mobile/budgets");
  if (result.kind !== "response") {
    return { ok: false, ...failureForOutcome(result, "Your budget") };
  }
  return parseBudgetsResponse(result.status, result.body);
}

/** Money in/out/net, categories and top people for a period (whole Kigali days, `to` exclusive). */
export async function fetchInsights(params: {
  from: string;
  to: string;
  accountIds?: string[];
  compare?: boolean;
}): Promise<InsightsResult> {
  const q = new URLSearchParams({ from: params.from, to: params.to, tz: "Africa/Kigali" });
  for (const id of params.accountIds ?? []) q.append("account_id", id);
  if (params.compare) q.set("compare", "previous");
  const result = await bearerGet(`/api/mobile/insights/overview?${q.toString()}`);
  if (result.kind !== "response") {
    return { ok: false, ...failureForOutcome(result, "Insights") };
  }
  return parseInsightsResponse(result.status, result.body);
}

/** The transactions behind one number on the Insights screen. */
export async function fetchDrilldown(d: Drilldown, limit = 50, offset = 0): Promise<DrilldownResult> {
  const q = new URLSearchParams({
    kind: d.kind,
    currency: d.currency,
    from: d.from,
    to: d.to,
    limit: String(limit),
    offset: String(offset),
  });
  if (d.value !== null) q.set("value", d.value);
  for (const id of d.accountIds ?? []) q.append("account_id", id);
  const result = await bearerGet(`/api/mobile/insights/drilldown?${q.toString()}`);
  if (result.kind !== "response") {
    return { ok: false, ...failureForOutcome(result, "These transactions") };
  }
  return parseDrilldownResponse(result.status, result.body);
}

/** Wallets with an honest balance label (Confirmed / Estimated / Out of date / Not available). */
export async function fetchWallets(): Promise<WalletsResult> {
  const result = await bearerGet("/api/mobile/accounts");
  if (result.kind !== "response") {
    return { ok: false, ...failureForOutcome(result, "Your wallets") };
  }
  return parseWalletsResponse(result.status, result.body);
}

/** People and merchants with sent/received/net per currency (all time). */
export async function fetchPeople(params: { q?: string; kind?: PersonKind; limit?: number }): Promise<PeopleResult> {
  const q = new URLSearchParams({ limit: String(params.limit ?? 100) });
  if (params.q && params.q.trim()) q.set("q", params.q.trim().slice(0, 80));
  if (params.kind) q.set("kind", params.kind);
  const result = await bearerGet(`/api/mobile/counterparties?${q.toString()}`);
  if (result.kind !== "response") {
    return { ok: false, ...failureForOutcome(result, "People and merchants") };
  }
  return parsePeopleResponse(result.status, result.body);
}

/** One person or merchant, with their transactions. */
export async function fetchPerson(id: string, limit = 50): Promise<PersonResult> {
  const result = await bearerGet(`/api/mobile/counterparties/${encodeURIComponent(id)}?limit=${limit}`);
  if (result.kind !== "response") {
    return { ok: false, ...failureForOutcome(result, "This person") };
  }
  return parsePersonResponse(result.status, result.body);
}
