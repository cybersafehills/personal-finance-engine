import { NextRequest } from "next/server";

import { isFinancialStatementsEnabled } from "../../../../lib/financial-statements";
import { toMobileStatement, type MobileStatement, type StatementRowInput } from "../../../../lib/mobile-statements";
import { mobileGet, mobileOptions } from "../../../../lib/mobile-request";
import { getActiveWorkspaceId } from "../../../../lib/queries";
import { supabaseSession } from "../../../../lib/supabase-session-server";

// GET /api/mobile/statements - the user's generated statements, newest first,
// for the mobile app (ADR 0019). Read-only: generating statements, packs,
// schedules and provider documents stay on the web. Dark with the web feature:
// when FINANCIAL_STATEMENTS_ENABLED is off the answer is `enabled: false`.

export const OPTIONS = mobileOptions;

const LIMIT = 30;

const COLUMNS =
  "id, statement_id, statement_type, scope, status, period_start, period_end, timezone, currency, opening_balance_minor, closing_balance_minor, total_credit_minor, total_debit_minor, total_fees_minor, transaction_count, per_currency, reconciles, coverage_metadata, supersedes_id, generated_at";

export function GET(request: NextRequest) {
  return mobileGet(request, "statements", async () => {
    if (!isFinancialStatementsEnabled()) {
      return { enabled: false, statements: [] as MobileStatement[] };
    }

    // No session cookie here, so this is the user's personal workspace - the
    // same scope the Inbox and Budgets use. A bare `from("statements")` would
    // list every workspace the user belongs to, mixing a household's
    // statements into a personal screen with nothing to say they are not theirs.
    const workspaceId = await getActiveWorkspaceId();
    if (!workspaceId) return { enabled: true, statements: [] as MobileStatement[] };

    const { data, error } = await (await supabaseSession())
      .from("statements")
      .select(COLUMNS)
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(LIMIT);
    if (error) throw new Error("statements lookup failed");

    const statements = ((data ?? []) as unknown as StatementRowInput[])
      .map(toMobileStatement)
      .filter((s): s is MobileStatement => s !== null);
    return { enabled: true, statements };
  });
}
