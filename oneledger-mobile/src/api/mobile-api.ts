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
import type { PayIntent } from "@/features/pay/types";
import {
  parseOfferResponse,
  parsePartResponse,
  parsePlanResponse,
  parsePrefsResponse,
  parseStopResponse,
  type SaveOnFailure,
  type SaveOnResult,
} from "@/features/save-on/parse";
import { parseSavingsResponse, type SaveOnSavings } from "@/features/save-on/savings";
import type { SaveOnLevels, SaveOnOffer, SaveOnPlan, SaveOnPrefs } from "@/features/save-on/types";
import { parseCategoriesResponse, type CategoriesResult } from "@/features/categories/parse";
import {
  parseRulesResponse,
  parseSetActiveResponse,
  type RulesResult,
  type SetActiveResult,
} from "@/features/rules/parse";
import {
  parseBillResponse,
  parseBillsEnabled,
  parseBillsResponse,
  parseOriginalResponse,
  type BillResult,
  type OriginalResult,
  type BillsResult,
} from "@/features/bills/parse";
import {
  parseReportDownloadResponse,
  parseReportResponse,
  parseReportsResponse,
  type ReportDownloadResult,
  type ReportResult,
  type ReportsResult,
} from "@/features/reports/parse";
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
import { parseMoreFlags, type MoreFlags } from "@/features/more/groups";
import { parseClassifyResponse, parsePrepareResponse, type ClassifyResponse, type PrepareResponse } from "@/features/scan/parse";
import { parseSpacesEnabled } from "@/features/spaces/config";
import type { InviteRole, MemberRole } from "@/features/spaces/members";
import {
  parseInviteResponse,
  parseSimpleWrite,
  type WriteFailure,
  type WriteResult,
} from "@/features/spaces/members-parse";
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
  granularity?: "day" | "week" | "month";
}): Promise<InsightsResult> {
  const q = new URLSearchParams({ from: params.from, to: params.to, tz: "Africa/Kigali" });
  for (const id of params.accountIds ?? []) q.append("account_id", id);
  if (params.compare) q.set("compare", "previous");
  if (params.granularity) q.set("granularity", params.granularity);
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

/** Say whether a handed-off payment was sent or didn't go through, when no provider message has settled it. */
export async function settlePayIntent(id: string, outcome: "sent" | "failed"): Promise<PayIntentResult> {
  const result = await bearerPost(`/api/mobile/pay/intents/${encodeURIComponent(id)}/settle`, { outcome });
  if (result.kind !== "response") return intentFailure(result);
  return parseIntentResponse(result.status, result.body);
}

/** Whether households are on for this user. Any failure means "not offered". */
export async function fetchSpacesEnabled(): Promise<boolean> {
  const result = await bearerGet("/api/mobile/config");
  return result.kind === "response" && parseSpacesEnabled(result.status, result.body);
}

/** Which optional features are on, for the More screen; null if the server can't say. */
export async function fetchMoreFlags(): Promise<MoreFlags | null> {
  const result = await bearerGet("/api/mobile/config");
  return result.kind === "response" ? parseMoreFlags(result.status, result.body) : null;
}

/** The categorization rules of the active Space, in the order they are checked. */
export async function fetchRules(): Promise<RulesResult> {
  const result = await bearerGet("/api/mobile/categorization-rules");
  if (result.kind !== "response") {
    return { ok: false, ...failureForOutcome(result, "Your rules") };
  }
  return parseRulesResponse(result.status, result.body);
}

/** Pause or resume one rule. Names the Space explicitly; the server never defaults a write to Personal. */
export async function setRuleActive(workspaceId: string, ruleId: string, active: boolean): Promise<SetActiveResult> {
  const r = await bearerPost("/api/mobile/categorization-rules/active", { workspaceId, ruleId, active });
  return r.kind === "response" ? parseSetActiveResponse(r.status, r.body) : spaceFailure(r);
}

/** Whether Bills is on for the active Space. Any failure means "not offered". */
export async function fetchBillsEnabled(): Promise<boolean> {
  const result = await bearerGet("/api/mobile/config");
  return result.kind === "response" && parseBillsEnabled(result.status, result.body);
}

/** The newest documents in the active Space, optionally one status. */
export async function fetchBills(status?: string): Promise<BillsResult> {
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  const result = await bearerGet(`/api/mobile/bills${query}`);
  if (result.kind !== "response") {
    return { ok: false, ...failureForOutcome(result, "Bills") };
  }
  return parseBillsResponse(result.status, result.body);
}

/** One document: details, extracted fields, checks and history, as the server renders them. */
export async function fetchBill(id: string): Promise<BillResult> {
  const result = await bearerGet(`/api/mobile/bills/${encodeURIComponent(id)}`);
  if (result.kind !== "response") {
    const f = failureForOutcome(result, "That document");
    return { ok: false, reason: f.reason, message: f.message };
  }
  return parseBillResponse(result.status, result.body);
}

/**
 * A fresh short-lived link to a document's original. Asking is audited on the
 * server, so ask once per tap, open the link at once, and never store or log it.
 */
export async function fetchBillOriginal(id: string): Promise<OriginalResult> {
  const r = await bearerPost(`/api/mobile/bills/${encodeURIComponent(id)}/original`, {});
  if (r.kind !== "response") {
    const f = failureForOutcome(r, "That document");
    return { ok: false, reason: f.reason, message: f.message };
  }
  return parseOriginalResponse(r.status, r.body);
}

/** All-time spending per category, from the web's canonical totals (the app never recomputes them). */
export async function fetchCategories(): Promise<CategoriesResult> {
  const result = await bearerGet("/api/mobile/categories");
  if (result.kind !== "response") {
    return { ok: false, ...failureForOutcome(result, "Your categories") };
  }
  return parseCategoriesResponse(result.status, result.body);
}

/** The user's daily report runs, newest first. Dates and sentences are rendered by the server. */
export async function fetchReports(): Promise<ReportsResult> {
  const result = await bearerGet("/api/mobile/reports");
  if (result.kind !== "response") {
    return { ok: false, ...failureForOutcome(result, "Your reports") };
  }
  return parseReportsResponse(result.status, result.body);
}

/** One report, every figure from its stored snapshot. */
export async function fetchReport(id: string): Promise<ReportResult> {
  const result = await bearerGet(`/api/mobile/reports/${encodeURIComponent(id)}`);
  if (result.kind !== "response") {
    const f = failureForOutcome(result, "That report");
    return { ok: false, reason: f.reason, message: f.message };
  }
  return parseReportResponse(result.status, result.body);
}

/** A fresh five-minute link to a report's PDF. Ask on every tap and open it at once; never store or log it. */
export async function fetchReportDownload(id: string): Promise<ReportDownloadResult> {
  const result = await bearerGet(`/api/mobile/reports/${encodeURIComponent(id)}/document`);
  if (result.kind !== "response") {
    const f = failureForOutcome(result, "That report");
    return { ok: false, reason: f.reason, message: f.message };
  }
  return parseReportDownloadResponse(result.status, result.body);
}

// --- Space & members writes (POST /api/mobile/spaces/..., docs/mobile-api.md) ---
// Each names its Space explicitly; the server never falls back to Personal for a write.

const spaceFailure = (outcome: Exclude<Awaited<ReturnType<typeof bearerGet>>, { kind: "response" }>): WriteFailure => {
  const f = failureForOutcome(outcome, "That");
  return { ok: false, reason: f.reason, message: f.message };
};

export async function setMemberRole(workspaceId: string, membershipId: string, role: MemberRole): Promise<WriteResult> {
  const r = await bearerPost("/api/mobile/spaces/members/role", { workspaceId, membershipId, role });
  return r.kind === "response" ? parseSimpleWrite(r.status, r.body) : spaceFailure(r);
}

export async function removeMember(workspaceId: string, membershipId: string): Promise<WriteResult> {
  const r = await bearerPost("/api/mobile/spaces/members/remove", { workspaceId, membershipId });
  return r.kind === "response" ? parseSimpleWrite(r.status, r.body) : spaceFailure(r);
}

/** The returned link is shown once and never stored. */
export async function inviteMember(
  workspaceId: string,
  email: string,
  role: InviteRole,
): Promise<WriteResult<{ link: string | null; emailSent: boolean }>> {
  const r = await bearerPost("/api/mobile/spaces/invites", { workspaceId, email, role });
  return r.kind === "response" ? parseInviteResponse(r.status, r.body) : spaceFailure(r);
}

export async function revokeInvite(workspaceId: string, inviteId: string): Promise<WriteResult> {
  const r = await bearerPost("/api/mobile/spaces/invites/revoke", { workspaceId, inviteId });
  return r.kind === "response" ? parseSimpleWrite(r.status, r.body) : spaceFailure(r);
}

/** Read a scanned QR string and say what it is. Read-only: nothing is stored or dialed. */
export async function classifyScan(raw: string): Promise<ClassifyResponse> {
  const result = await bearerPost("/api/mobile/pay/scan/classify", { raw });
  if (result.kind !== "response") return { ok: false, disabled: false, ...failureForOutcome(result, "That code") };
  return parseClassifyResponse(result.status, result.body);
}

/** Turn a scanned code into a hand-off (a draft payment and the route to open). Never charges anything. */
export async function prepareScan(raw: string, amountMinor?: number): Promise<PrepareResponse> {
  const result = await bearerPost("/api/mobile/pay/scan/prepare", amountMinor === undefined ? { raw } : { raw, amountMinor });
  if (result.kind !== "response") return { ok: false, ...failureForOutcome(result, "That payment") };
  return parsePrepareResponse(result.status, result.body);
}

// ---------------------------------------------------------------------------
// Save On: a payment sent as several transfers (see features/save-on).
// ---------------------------------------------------------------------------

const saveOnFailure = (
  result: Exclude<Awaited<ReturnType<typeof bearerGet>>, { kind: "response" }>,
): SaveOnFailure => {
  const f = failureForOutcome(result, "Save On");
  return { ok: false, reason: f.reason, code: null, message: f.message };
};

export type SaveOnOfferBody = {
  paymentType: "pay_person" | "pay_merchant";
  amountMinor: number;
  /** "ekash" when the person chose to send over eKash. */
  networkSlug?: "ekash";
  sourceAccountId?: string;
  recipientMsisdn?: string;
};

/** Is there a split to suggest for this amount? Read-only; the server decides the parts. */
export async function fetchSaveOnOffer(body: SaveOnOfferBody): Promise<SaveOnResult<{ offer: SaveOnOffer | null }>> {
  const result = await bearerPost("/api/mobile/pay/splits/offer", body);
  if (result.kind !== "response") return saveOnFailure(result);
  return parseOfferResponse(result.status, result.body);
}

/** Start the split: creates the plan and part 1 as an ordinary draft payment. Nothing is sent. */
export async function startSaveOn(
  body: CreatePayIntentBody & { networkSlug?: "ekash" },
): Promise<SaveOnResult<{ planId: string; intent: PayIntent; index: number | null }>> {
  const result = await bearerPost("/api/mobile/pay/splits/start", body);
  if (result.kind !== "response") return saveOnFailure(result);
  return parsePartResponse(result.status, result.body);
}

export async function fetchSaveOnPlan(planId: string): Promise<SaveOnResult<{ plan: SaveOnPlan }>> {
  const result = await bearerGet(`/api/mobile/pay/splits/${encodeURIComponent(planId)}`);
  if (result.kind !== "response") return saveOnFailure(result);
  return parsePlanResponse(result.status, result.body);
}

/** Prepare the next part: only once the previous one is settled (the server answers 409 `waiting` otherwise). */
export async function nextSaveOnPart(
  planId: string,
): Promise<SaveOnResult<{ planId: string; intent: PayIntent; index: number | null }>> {
  const result = await bearerPost(`/api/mobile/pay/splits/${encodeURIComponent(planId)}/next`, {});
  if (result.kind !== "response") return saveOnFailure(result);
  return parsePartResponse(result.status, result.body);
}

export async function stopSaveOn(planId: string): Promise<SaveOnResult<Record<never, never>>> {
  const result = await bearerPost(`/api/mobile/pay/splits/${encodeURIComponent(planId)}/stop`, {});
  if (result.kind !== "response") return saveOnFailure(result);
  return parseStopResponse(result.status, result.body);
}

export async function fetchSaveOnPrefs(): Promise<SaveOnResult<{ preferences: SaveOnPrefs; levels: SaveOnLevels }>> {
  const result = await bearerGet("/api/mobile/pay/splits/preferences");
  if (result.kind !== "response") return saveOnFailure(result);
  return parsePrefsResponse(result.status, result.body);
}

export async function saveSaveOnPrefs(prefs: SaveOnPrefs): Promise<SaveOnResult<{ preferences: SaveOnPrefs; levels: SaveOnLevels }>> {
  const result = await bearerPost("/api/mobile/pay/splits/preferences", prefs);
  if (result.kind !== "response") return saveOnFailure(result);
  return parsePrefsResponse(result.status, result.body);
}

/** How much Save On has saved in transfer fees, over 24 hours to all time. Read-only. */
export async function fetchSaveOnSavings(): Promise<SaveOnResult<{ savings: SaveOnSavings }>> {
  const result = await bearerGet("/api/mobile/pay/splits/savings");
  if (result.kind !== "response") return saveOnFailure(result);
  return parseSavingsResponse(result.status, result.body);
}
