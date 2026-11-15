import { failureForStatus, type BearerFailure } from "@/api/bearer";

import type { Currency, DownloadFormat, Statement, StatementTotals } from "./types";

const STATUSES = ["preparing", "generating", "ready", "failed"] as const;
const CURRENCIES: readonly string[] = ["RWF", "EUR", "USD"];

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;
const str = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const numOrNull = (v: unknown): number | null => (num(v) ? v : null);

function parseTotals(raw: unknown): StatementTotals | null {
  if (!isRecord(raw) || !str(raw.currency) || !CURRENCIES.includes(raw.currency)) return null;
  if (!num(raw.creditsMinor) || !num(raw.debitsMinor) || !num(raw.feesMinor)) return null;
  return {
    currency: raw.currency as Currency,
    openingMinor: numOrNull(raw.openingMinor),
    closingMinor: numOrNull(raw.closingMinor),
    creditsMinor: raw.creditsMinor,
    debitsMinor: raw.debitsMinor,
    feesMinor: raw.feesMinor,
    reconciles: typeof raw.reconciles === "boolean" ? raw.reconciles : null,
  };
}

function parseStatement(raw: unknown): Statement | null {
  if (!isRecord(raw)) return null;
  if (!str(raw.id) || !str(raw.reference) || !str(raw.periodLabel)) return null;
  if (!STATUSES.includes(raw.status as Statement["status"])) return null;
  const list = Array.isArray(raw.totals) ? raw.totals : [];
  return {
    id: raw.id,
    reference: raw.reference,
    periodLabel: raw.periodLabel,
    scopeLabel: str(raw.scopeLabel) ? raw.scopeLabel : "Statement",
    typeLabel: str(raw.typeLabel) ? raw.typeLabel : "Standard",
    status: raw.status as Statement["status"],
    transactionCount: num(raw.transactionCount) && raw.transactionCount > 0 ? raw.transactionCount : 0,
    generatedAt: str(raw.generatedAt) ? raw.generatedAt : null,
    isUpdatedVersion: raw.isUpdatedVersion === true,
    warningCount: num(raw.warningCount) && raw.warningCount > 0 ? raw.warningCount : 0,
    totals: list.map(parseTotals).filter((t): t is StatementTotals => t !== null),
  };
}

export type StatementsResult =
  | { ok: true; enabled: boolean; statements: Statement[] }
  | ({ ok: false } & BearerFailure);

/** Maps the endpoint's HTTP status and JSON to a typed result. */
export function parseStatementsResponse(status: number, body: unknown): StatementsResult {
  if (status === 200 && isRecord(body) && body.ok === true && Array.isArray(body.statements)) {
    return {
      ok: true,
      enabled: body.enabled !== false,
      statements: body.statements.map(parseStatement).filter((s): s is Statement => s !== null),
    };
  }
  if (status === 200) {
    return { ok: false, reason: "error", message: "The statements response wasn't understood." };
  }
  return { ok: false, ...failureForStatus(status, "Your statements") };
}

export type DownloadResult =
  | { ok: true; url: string; format: DownloadFormat }
  | { ok: false; reason: "unavailable" | "not_found" | "not_ready" | "unauthorized" | "mfa_required" | "error"; message: string };

const DOWNLOAD_MESSAGES = {
  unavailable: "Statements aren't available yet.",
  not_found: "That statement couldn't be found.",
  not_ready: "That statement is still being prepared. Try again in a moment.",
  failed: "Couldn't prepare the download. Try again.",
} as const;

/** A download link is only ever accepted over https. */
export function parseDownloadResponse(status: number, body: unknown): DownloadResult {
  if (status === 200 && isRecord(body) && body.ok === true) {
    const d = body.download;
    if (isRecord(d) && str(d.url) && d.url.startsWith("https://") && (d.format === "pdf" || d.format === "csv")) {
      return { ok: true, url: d.url, format: d.format };
    }
    const reason = typeof body.reason === "string" ? body.reason : "";
    if (reason === "unavailable" || reason === "not_found" || reason === "not_ready") {
      return { ok: false, reason, message: DOWNLOAD_MESSAGES[reason] };
    }
    return { ok: false, reason: "error", message: DOWNLOAD_MESSAGES.failed };
  }
  const f = failureForStatus(status, "that statement");
  return { ok: false, reason: f.reason, message: f.message };
}
