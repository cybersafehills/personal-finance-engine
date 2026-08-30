import "server-only";

import { redirect } from "next/navigation";
import { supabaseSession } from "../supabase-session-server";
import { internalRedirectPath } from "../internal-redirect";
import { needsMfaStepUp } from "./assurance-policy";

/**
 * Require an MFA challenge for sensitive actions once the user has enrolled
 * a verified factor. Users without MFA retain existing access while the
 * product can progressively drive enrollment.
 */
export async function requireMfaForSensitiveAction(
  next: string,
): Promise<void> {
  const supabase = await supabaseSession();
  const [{ data: factors }, { data: assurance }] = await Promise.all([
    supabase.auth.mfa.listFactors(),
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
  ]);

  if (needsMfaStepUp(factors?.totp?.length ?? 0, assurance?.currentLevel)) {
    const safeNext = internalRedirectPath(next);
    redirect(`/auth/mfa?next=${encodeURIComponent(safeNext)}`);
  }
}
