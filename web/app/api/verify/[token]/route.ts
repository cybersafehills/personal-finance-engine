import { NextRequest, NextResponse } from "next/server";
import { isFinancialStatementsEnabled } from "../../../../lib/financial-statements";
import {
  verifyRateLimited,
  verifyStatementToken,
} from "../../../../lib/statement-verify";

// Public JSON verification API. Same minimal projection as /verify/<token>
// (identity + integrity only - never a balance, transaction, account
// identifier or holder name). No auth (/api/verify is in proxy.ts
// PUBLIC_PATHS); 404 when the flag is off; per-IP rate-limited, shared
// with the HTML page.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  if (!isFinancialStatementsEnabled()) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const ip = (request.headers.get("x-forwarded-for") ?? "").split(",")[0]
    .trim() || "unknown";
  if (verifyRateLimited(ip)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const { token } = await params;
  const result = await verifyStatementToken(token);
  const httpStatus = result.status === "not_found" ? 404 : 200;

  return NextResponse.json(result, {
    status: httpStatus,
    headers: { "cache-control": "no-store" },
  });
}
