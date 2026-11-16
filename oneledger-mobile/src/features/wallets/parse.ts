import { failureForStatus, type BearerFailure } from "@/api/bearer";
import { minor } from "@/features/insights/parse";

import type { BalanceReason, BalanceStatus, Wallet, WalletBalance } from "./types";

const STATUSES: readonly BalanceStatus[] = ["confirmed", "estimated", "stale", "unavailable"];
const REASONS: readonly BalanceReason[] = [
  "no_baseline", "baseline_old", "unresolved_activity", "reconciliation_mismatch",
  "user_stated_baseline", "activity_since_baseline",
];
const CURRENCIES = ["RWF", "EUR", "USD"] as const;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === "string" && v.length > 0;

function balance(raw: unknown): WalletBalance | null {
  if (!isRecord(raw) || !STATUSES.includes(raw.status as BalanceStatus)) return null;
  const status = raw.status as BalanceStatus;
  const amount = raw.amount_minor === null ? null : minor(raw.amount_minor);
  // The invariant the whole feature rests on: no number without a status that
  // supports one, and "unavailable" never carries one.
  if (status === "unavailable" ? amount !== null : amount === null) return null;
  const basis = raw.basis === "provider_reported" || raw.basis === "manual" ? raw.basis : null;
  const reasons = (Array.isArray(raw.reasons) ? raw.reasons : []).filter(
    (r): r is BalanceReason => REASONS.includes(r as BalanceReason),
  );
  return { status, amountMinor: amount, asOf: typeof raw.as_of === "string" ? raw.as_of : null, basis, reasons };
}

function wallet(raw: unknown): Wallet | null {
  if (!isRecord(raw) || !str(raw.id) || !str(raw.name) || !str(raw.provider)) return null;
  if (!CURRENCIES.includes(raw.currency as (typeof CURRENCIES)[number])) return null;
  const b = balance(raw.balance);
  if (!b) return null;
  return {
    id: raw.id,
    name: raw.name,
    provider: raw.provider,
    currency: raw.currency as Wallet["currency"],
    isPrimary: raw.is_primary === true,
    latestTxnAt: typeof raw.latest_txn_at === "string" ? raw.latest_txn_at : null,
    balance: b,
  };
}

export type WalletsResult =
  | { ok: true; workspaceId: string; wallets: Wallet[] }
  | ({ ok: false } & BearerFailure);

export function parseWalletsResponse(status: number, body: unknown): WalletsResult {
  if (status !== 200 || !isRecord(body) || body.ok !== true || !Array.isArray(body.accounts) || !str(body.workspace_id)) {
    return { ok: false, ...failureForStatus(status, "Your wallets") };
  }
  return {
    ok: true,
    workspaceId: body.workspace_id,
    wallets: body.accounts.map(wallet).filter((w): w is Wallet => w !== null),
  };
}
