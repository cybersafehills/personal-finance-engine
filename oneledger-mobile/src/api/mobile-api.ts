import { bearerGet, bearerPost, failureForOutcome } from "@/api/bearer";
import { parseBudgetsResponse, type BudgetsResult } from "@/features/budgets/parse";
import {
  parseDownloadResponse,
  parseStatementsResponse,
  type DownloadResult,
  type StatementsResult,
} from "@/features/statements/parse";
import type { DownloadFormat } from "@/features/statements/types";
import {
  parseConfigResponse,
  parseIntentResponse,
  type PayConfigResult,
  type PayIntentResult,
} from "@/features/pay/parse";
import { parseInboxResponse, type InboxResult } from "@/features/inbox/parse";
import { parseSpacesEnabled } from "@/features/spaces/config";
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

/** The user's generated statements (read-only; generating stays on the web). */
export async function fetchStatements(): Promise<StatementsResult> {
  const result = await bearerGet("/api/mobile/statements");
  if (result.kind !== "response") {
    return { ok: false, ...failureForOutcome(result, "Your statements") };
  }
  return parseStatementsResponse(result.status, result.body);
}

/**
 * A fresh, five-minute download link for one ready statement. Ask on every tap
 * and open it straight away; never store or log it.
 */
export async function fetchStatementDownload(
  id: string,
  format: DownloadFormat,
): Promise<DownloadResult> {
  const result = await bearerGet(
    `/api/mobile/statements/${encodeURIComponent(id)}/document?format=${format}`,
  );
  if (result.kind !== "response") {
    const f = failureForOutcome(result, "That statement");
    return { ok: false, reason: f.reason, message: f.message };
  }
  return parseDownloadResponse(result.status, result.body);
}

/** Which payment features are on for this user. Any failure means "hide the button". */
export async function fetchPayConfig(): Promise<PayConfigResult> {
  const result = await bearerGet("/api/mobile/config");
  if (result.kind !== "response") {
    return { ok: false, ...failureForOutcome(result, "Payments") };
  }
  return parseConfigResponse(result.status, result.body);
}

const intentFailure = (result: Exclude<Awaited<ReturnType<typeof bearerGet>>, { kind: "response" }>): PayIntentResult => {
  const f = failureForOutcome(result, "That payment");
  return { ok: false, reason: f.reason, message: f.message };
};

export type CreatePayIntentBody = {
  paymentType: "pay_person" | "pay_merchant";
  amountMinor: number;
  idempotencyKey: string;
  recipientName?: string;
  recipientMsisdn?: string;
  merchantCode?: string;
  sourceAccountId?: string;
};

/** Prepare a draft payment. Never charges anything; the same idempotencyKey returns the same intent. */
export async function createPayIntent(body: CreatePayIntentBody): Promise<PayIntentResult> {
  const result = await bearerPost("/api/mobile/pay/intents", body);
  if (result.kind !== "response") return intentFailure(result);
  return parseIntentResponse(result.status, result.body);
}

/** A payment intent with its prepared USSD instruction. */
export async function fetchPayIntent(id: string): Promise<PayIntentResult> {
  const result = await bearerGet(`/api/mobile/pay/intents/${encodeURIComponent(id)}`);
  if (result.kind !== "response") return intentFailure(result);
  return parseIntentResponse(result.status, result.body);
}

/** Record that the user opened the dialer or shared/copied the code. Returns the refreshed intent. */
export async function recordPayHandoff(
  id: string,
  body:
    | { method: "dialer"; outcome: "dialer_opened" | "dialer_unsupported" }
    | { method: "copy"; outcome: "copied" | "fallback_shown" },
): Promise<PayIntentResult> {
  const result = await bearerPost(`/api/mobile/pay/intents/${encodeURIComponent(id)}/handoff`, body);
  if (result.kind !== "response") return intentFailure(result);
  return parseIntentResponse(result.status, result.body);
}

/** Whether households are on for this user. Any failure means "not offered". */
export async function fetchSpacesEnabled(): Promise<boolean> {
  const result = await bearerGet("/api/mobile/config");
  return result.kind === "response" && parseSpacesEnabled(result.status, result.body);
}
