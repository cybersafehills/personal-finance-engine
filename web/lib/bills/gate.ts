import "server-only";
import { FeatureDisabledError } from "../pay/gate";

// Server-authoritative gating for the Bills & Expenses (Invoice & Expense
// Processor) surface. There is no general feature-flag system in this
// codebase (a prior phase decided none was needed - see docs); this
// mirrors lib/pay/gate.ts.
//
// Bills is a NEW, ledger-adjacent capability, so - like SCAN_TO_PAY_ENABLED
// and SMS_RECONCILIATION_ENABLED - it is OPT-IN: OFF unless the value is
// the exact string "true". The optional workspace allowlist supports a
// staged internal beta. Every check runs on the server in every bills
// action / route / RPC wrapper - a disabled flag blocks the backend, not
// merely a hidden button (master prompt §24).
//
//   BILLS_ENABLED             - master switch for the whole surface
//                               (/bills, its actions, the API routes).
//   BILLS_WORKSPACE_ALLOWLIST - if non-empty, ONLY these workspace ids
//                               see the surface. Empty/unset = everyone.
//   BILLS_EXTRACTION_ENABLED  - Phase 2 AI classification + extraction.
//                               OPT-IN. Requires AI_PROVIDER + a key.
//   BILLS_AUTO_APPROVAL_ENABLED - DARK. Architected-for (master prompt
//                               §2); never honoured in the first release.

function envEnabledOptIn(name: string): boolean {
  return process.env[name] === "true";
}

function workspaceAllowed(workspaceId: string | null): boolean {
  const raw = process.env.BILLS_WORKSPACE_ALLOWLIST?.trim();
  if (!raw) return true;
  if (!workspaceId) return false;
  const allow = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return allow.length === 0 || allow.includes(workspaceId);
}

export function isBillsEnabled(workspaceId: string | null): boolean {
  return envEnabledOptIn("BILLS_ENABLED") && workspaceAllowed(workspaceId);
}

/** Phase 2: AI classification + structured extraction. Downstream of
 *  BILLS_ENABLED + the allowlist. */
export function isBillsExtractionEnabled(workspaceId: string | null): boolean {
  return isBillsEnabled(workspaceId) && envEnabledOptIn("BILLS_EXTRACTION_ENABLED");
}

/** DARK. Kept as a function so Phase 6 can wire policy in without a new
 *  flag, but it must return false for the entire first release. */
export function isBillsAutoApprovalEnabled(): boolean {
  return false;
}

export function assertBillsEnabled(workspaceId: string | null): void {
  if (!isBillsEnabled(workspaceId)) {
    throw new FeatureDisabledError("bills");
  }
}

export { FeatureDisabledError };

// --- upload limits (master prompt §5) -----------------------------------
// Configurable, with safe defaults. Read lazily so a missing/garbage
// value degrades to the default rather than crashing a request.

const DEFAULT_MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15 MiB
const DEFAULT_MAX_PAGE_COUNT = 25;
const DEFAULT_SIGNED_URL_TTL_SECONDS = 300;

function positiveIntEnv(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

export function billsMaxUploadBytes(): number {
  return positiveIntEnv("BILLS_MAX_UPLOAD_BYTES", DEFAULT_MAX_UPLOAD_BYTES);
}

export function billsMaxPageCount(): number {
  return positiveIntEnv("BILLS_MAX_PAGE_COUNT", DEFAULT_MAX_PAGE_COUNT);
}

export function billsSignedUrlTtlSeconds(): number {
  return positiveIntEnv("BILLS_SIGNED_URL_TTL_SECONDS", DEFAULT_SIGNED_URL_TTL_SECONDS);
}
