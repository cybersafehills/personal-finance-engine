// Structured error monitoring for the Spaces surface (master prompt
// "Monitoring"). This codebase has no APM/Sentry - the platform log
// drain is the sink, and a stable "[spaces-error]" prefix makes the
// failures greppable / alertable as one family (mirrors logScanError in
// lib/pay/scan-analytics.ts). Every message is redacted first: a
// PostgREST error or an Error.message can quote a Space / person name,
// an email, or a row id.

export type SpacesErrorStage =
  | "create_household"
  | "invite"
  | "accept_invite"
  | "member_manage"
  | "source_share"
  | "attribution"
  | "duplicate_resolve"
  | "statement_import"
  | "notification"
  | "budget_sweep";

/** Strip ids / long digit runs / URLs / emails from an error message and cap it. The stack is never logged. */
export function redactErrorText(input: unknown): string {
  const raw = input instanceof Error
    ? input.message
    : typeof input === "string"
    ? input
    : "unknown error";
  return raw
    .replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      "‹redacted-id›",
    )
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "‹redacted-email›")
    .replace(/https?:\/\/\S+/gi, "‹redacted-url›")
    .replace(/\d(?:[\s-]?\d){5,}/g, "‹redacted›")
    .slice(0, 240);
}

/**
 * Log one Spaces failure. A denied RLS write, a refused RPC, or an
 * unexpected Postgres error all pass through here so the platform log
 * drain sees them under one prefix. Never throws.
 */
export function logSpacesError(stage: SpacesErrorStage, err: unknown): void {
  try {
    console.error(`[spaces-error] stage=${stage}`, redactErrorText(err));
  } catch {
    // logging must never break the caller
  }
}
