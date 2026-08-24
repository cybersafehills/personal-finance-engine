import { PageHeader } from "../../../components/PageHeader";
import { supabaseSession } from "../../../lib/supabase-session-server";
import { SignOutOthersButton } from "./SignOutOthersButton";

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

  return (
    <div>
      <PageHeader
        title="Security"
        subtitle="Your sign-in details and active sessions"
      />

      <div className="flex flex-col gap-3">
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
            If you&apos;ve signed in somewhere you don&apos;t recognize, or
            just want to sign out everywhere else, use this. It
            doesn&apos;t affect the session you&apos;re using right now.
          </p>
          <SignOutOthersButton />
        </div>
      </div>
    </div>
  );
}
