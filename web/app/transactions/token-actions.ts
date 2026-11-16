"use server";

import { requireMfaForSensitiveAction } from "../../lib/auth/assurance";
import { revealUtilityToken } from "../../lib/sensitive/utility-token";
import { formatUtilityToken } from "../../lib/sensitive/token-format";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Reveal a prepaid-electricity token. Step-up MFA first (users with a verified
// factor must be at aal2), then the database function authorises (member+,
// source visibility), rate-limits and audits. The result is shown once and
// never persisted client-side.
export async function revealUtilityTokenAction(
  transactionId: string,
): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  if (!UUID.test(transactionId)) return { ok: false, error: "This token isn't available to you." };
  await requireMfaForSensitiveAction(`/transactions/${transactionId}`);
  const r = await revealUtilityToken(transactionId);
  return r.ok ? { ok: true, token: formatUtilityToken(r.digits) } : r;
}
