import "server-only";
import { supabaseServer } from "./supabase-server";
import { isVerificationToken } from "./statement-id";

// Public statement verification (master prompt sections 20 / 21). Given an
// opaque token, return ONLY what confirms the document's identity and
// integrity - never a balance, transaction, account identifier or holder
// name. Service-role read (the /verify page has no session); the token's
// own entropy is the enumeration defence, plus a per-IP rate limit on the
// route.

export type StatementVerification =
  | { status: "not_found" }
  | { status: "revoked"; statementId: string }
  | {
    status: "verified";
    statementId: string;
    generatedAt: string | null;
    periodStart: string;
    periodEnd: string;
    currency: string;
    accountCount: number;
    transactionCount: number;
    statementType: "standard" | "detailed";
    scope: "single_account" | "all_accounts" | "filtered";
    filtered: boolean;
    integrity: "fingerprinted" | "not_fingerprinted";
  };

export async function verifyStatementToken(
  token: string,
): Promise<StatementVerification> {
  if (!isVerificationToken(token)) return { status: "not_found" };

  const admin = supabaseServer();
  const { data, error } = await admin
    .from("statements")
    .select(
      "id, statement_id, status, generated_at, period_start, period_end, currency, account_ids, transaction_count, statement_type, scope, verification_revoked_at",
    )
    .eq("verification_token", token)
    .maybeSingle();

  if (error || !data || data.status !== "ready") {
    return { status: "not_found" };
  }
  if (data.verification_revoked_at) {
    return { status: "revoked", statementId: data.statement_id };
  }

  const { count } = await admin
    .from("statement_artifacts")
    .select("id", { count: "exact", head: true })
    .eq("statement_id", data.id)
    .eq("format", "pdf");

  return {
    status: "verified",
    statementId: data.statement_id,
    generatedAt: data.generated_at,
    periodStart: data.period_start,
    periodEnd: data.period_end,
    currency: data.currency,
    accountCount: (data.account_ids ?? []).length,
    transactionCount: Number(data.transaction_count),
    statementType: data.statement_type,
    scope: data.scope,
    filtered: data.scope === "filtered",
    integrity: (count ?? 0) > 0 ? "fingerprinted" : "not_fingerprinted",
  };
}
