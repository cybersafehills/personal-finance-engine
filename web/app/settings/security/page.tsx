import { PageHeader } from "../../../components/PageHeader";
import { supabaseSession } from "../../../lib/supabase-session-server";
import { SignOutOthersButton } from "./SignOutOthersButton";
import { MfaManager } from "../../../components/MfaManager";

export const dynamic = "force-dynamic";

function formatTimestamp(iso: string | undefined): string {
  if (!iso) return "Never";
  return new Date(iso).toLocaleString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Kigali",
  });
}

export default async function SecurityPage() {
  const supabase = await supabaseSession();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const [{ data: factorData }, { data: assurance }] = await Promise.all([
    supabase.auth.mfa.listFactors(),
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
  ]);
  const factors = (factorData?.totp ?? []).map((factor) => ({
    id: factor.id,
    friendlyName: factor.friendly_name ?? "Authenticator app",
    createdAt: factor.created_at,
  }));

  return (
    <div>
      <PageHeader
        backHref="/settings"
        title="Sign-in & security"
        subtitle="Your password, two-step verification, and active sessions"
      />

      <div className="flex flex-col gap-3">
        <div className="rounded-card border border-border-subtle bg-surface p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-medium text-text-primary">
                Current session
              </h2>
              <p className="mt-1 text-sm text-text-muted">
                {assurance?.currentLevel === "aal2"
                  ? "MFA verified — sensitive actions are unlocked for this session."
                  : factors.length > 0
                  ? "Password verified — MFA confirmation is required for sensitive actions."
                  : "Password verified — add an authenticator for stronger protection."}
              </p>
            </div>
            <span className="rounded-full bg-background px-3 py-1 text-xs font-medium text-text-secondary">
              {assurance?.currentLevel === "aal2" ? "AAL2" : "AAL1"}
            </span>
          </div>
        </div>

        <MfaManager initialFactors={factors} />

        <div className="rounded-card border border-border-subtle bg-surface p-5">
          <dl className="flex flex-col gap-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-text-muted">Email</dt>
              <dd className="text-text-primary">{user?.email}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-text-muted">Account created</dt>
              <dd className="text-text-primary">
                {formatTimestamp(user?.created_at)}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-text-muted">Last sign-in</dt>
              <dd className="text-text-primary">
                {formatTimestamp(user?.last_sign_in_at)}
              </dd>
            </div>
          </dl>
        </div>

        <div className="flex flex-col gap-2 rounded-card border border-border-subtle bg-surface p-5">
          <h2 className="text-sm font-medium text-text-primary">
            Other sessions
          </h2>
          <p className="text-sm text-text-muted">
            If you&apos;ve signed in somewhere you don&apos;t recognize, or just
            want to sign out everywhere else, use this. It doesn&apos;t affect
            the session you&apos;re using right now.
          </p>
          <SignOutOthersButton />
        </div>
      </div>
    </div>
  );
}
