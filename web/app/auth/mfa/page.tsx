import { redirect } from "next/navigation";
import { OneLedgerLogo } from "../../../components/brand/OneLedgerLogo";
import { MfaChallenge } from "../../../components/MfaChallenge";
import { internalRedirectPath } from "../../../lib/internal-redirect";
import { supabaseSession } from "../../../lib/supabase-session-server";

export const dynamic = "force-dynamic";

export default async function MfaPage(
  { searchParams }: { searchParams: Promise<{ next?: string | string[] }> },
) {
  const { next } = await searchParams;
  const safeNext = internalRedirectPath(typeof next === "string" ? next : null);
  const supabase = await supabaseSession();
  const [{ data: factors }, { data: assurance }] = await Promise.all([
    supabase.auth.mfa.listFactors(),
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
  ]);

  if (assurance?.currentLevel === "aal2") redirect(safeNext);

  const totp = (factors?.totp ?? []).map((factor) => ({
    id: factor.id,
    name: factor.friendly_name ?? "Authenticator app",
  }));
  if (totp.length === 0) redirect("/settings/security");

  return (
    <div className="mx-auto flex max-w-sm flex-col gap-6 py-10">
      <div className="text-center">
        <OneLedgerLogo height={40} className="mx-auto mb-4" />
        <h1 className="text-xl font-semibold text-text-primary">
          Security confirmation
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          Confirm this sensitive action with your authenticator.
        </p>
      </div>
      <MfaChallenge factors={totp} next={safeNext} />
    </div>
  );
}
