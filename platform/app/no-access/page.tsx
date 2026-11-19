import { redirect } from "next/navigation";
import { getAccessState } from "../../lib/console/access";
import { signOut } from "../actions";

export const metadata = { title: "No access" };

export default async function NoAccess() {
  const { state } = await getAccessState();
  if (state.kind === "signed_out") redirect("/login");
  if (state.kind === "mfa_required") redirect("/mfa");
  if (state.kind === "ok") redirect("/dashboard");
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <div className="rounded-card border border-border bg-surface p-6 shadow-card">
        <h1 className="text-base font-semibold">Access not available</h1>
        <p className="mt-2 text-sm text-text-2">
          This account is not enabled for the Platform Console. If you believe
          this is a mistake, ask a Platform Owner to review your access.
        </p>
        <form action={signOut} className="mt-4">
          <button className="rounded-control border border-border-strong px-3 py-2 text-sm hover:bg-surface-muted">
            Sign out
          </button>
        </form>
      </div>
    </main>
  );
}
