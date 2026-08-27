// Deterministic SMS-to-payment-intent matcher.
//
// The RULE REFERENCE for Phase 2b reconciliation. The authoritative
// path is the SQL function
// `reconcile_transaction_with_payment_intents()` (migration
// 20260908000000) — this module is a narrow, deliberate duplication of
// the same per-condition logic, kept in sync BY HAND (same discipline
// as policy-engine.ts <-> policy_matches_transaction(), see
// docs/categorization-engine.md). It exists so the rules are
// unit-testable without a database and so the web app can preview a
// manual link.
//
// Pure and synchronous: no DB, no network, no wall clock — the caller
// passes `now` (via the intent/txn timestamps). Never mutates anything;
// it only decides.
//
// Non-custodial invariant: matching NEVER implies creating a ledger
// row. The transaction already exists (ingested); this only says which
// intent, if any, it satisfies.

export type ReconTransaction = {
  id: string;
  workspace_id: string;
  direction: "in" | "out" | "neutral";
  status: string;
  currency: string;
  amount_rwf: number;
  /** The phone number parsed from the SMS (any format). */
  counterparty_reference: string | null;
  occurred_at: string;
  source: string;
  /** True if a `status='linked'` payment_reconciliations row already exists for this txn. */
  already_linked?: boolean;
};

export type ReconIntent = {
  id: string;
  workspace_id: string;
  state: string;
  linked_transaction_id: string | null;
  amount_minor: number;
  recipient_msisdn_normalized: string | null;
  provider: string | null;
  created_at: string;
  expires_at: string | null;
};

export type ReconResult =
  | { status: "skipped"; reason: string }
  | { status: "no_match" }
  | { status: "linked"; intentId: string }
  | { status: "conflict"; intentIds: string[] };

const OPEN_STATES = new Set(["initiated", "awaiting_verification"]);
const GRACE_BEFORE_MS = 10 * 60 * 1000; // 10 minutes
const DEFAULT_WINDOW_AFTER_MS = 24 * 60 * 60 * 1000; // 24h fallback

/**
 * SQL mirror of `public.normalize_rw_msisdn` and
 * `web/lib/pay/phone.ts#normalizeRwandaMsisdn` — canonical
 * `2507XXXXXXXX`, or null. Keep all three in sync by hand.
 */
export function normalizeRwMsisdn(raw: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^0-9]/g, "");
  let candidate: string | null = null;
  if (/^250\d{9}$/.test(digits)) candidate = digits;
  else if (/^0\d{9}$/.test(digits)) candidate = "250" + digits.slice(1);
  else if (/^7\d{8}$/.test(digits)) candidate = "250" + digits;
  else return null;
  return /^2507[2389]\d{7}$/.test(candidate) ? candidate : null;
}

function providerAgrees(intentProvider: string | null, txnSource: string): boolean {
  if (!intentProvider) return true;
  if (intentProvider === "mtn" || intentProvider === "airtel") {
    // Both MTN and Airtel SMS ingest as `mtn_momo`-shaped today; tighten
    // when a dedicated source exists (mirrors the SQL).
    return txnSource === "mtn_momo";
  }
  return true;
}

export function matchTransactionToIntents(
  txn: ReconTransaction,
  intents: ReconIntent[],
): ReconResult {
  if (txn.direction !== "out" || txn.status !== "success" || txn.currency !== "RWF") {
    return { status: "skipped", reason: "not_an_outgoing_rwf_success" };
  }
  if (txn.already_linked) {
    return { status: "skipped", reason: "already_linked" };
  }

  const normTxnMsisdn = normalizeRwMsisdn(txn.counterparty_reference);
  if (!normTxnMsisdn) {
    return { status: "no_match" };
  }
  const occurred = Date.parse(txn.occurred_at);

  const candidates = intents.filter((i) => {
    if (i.workspace_id !== txn.workspace_id) return false;
    if (!OPEN_STATES.has(i.state)) return false;
    if (i.linked_transaction_id) return false;
    if (i.amount_minor !== txn.amount_rwf) return false;
    if (!i.recipient_msisdn_normalized || i.recipient_msisdn_normalized !== normTxnMsisdn) {
      return false;
    }
    if (!providerAgrees(i.provider, txn.source)) return false;
    const from = Date.parse(i.created_at) - GRACE_BEFORE_MS;
    const to = i.expires_at
      ? Date.parse(i.expires_at)
      : Date.parse(i.created_at) + DEFAULT_WINDOW_AFTER_MS;
    return occurred >= from && occurred <= to;
  });

  if (candidates.length === 0) return { status: "no_match" };
  if (candidates.length === 1) return { status: "linked", intentId: candidates[0].id };
  return { status: "conflict", intentIds: candidates.map((c) => c.id) };
}
