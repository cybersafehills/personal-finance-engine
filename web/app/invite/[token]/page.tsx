import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseSession } from "../../../lib/supabase-session-server";
import { hashToken } from "../../../lib/credentials";
import { AcceptInviteButton } from "./AcceptInviteButton";

export const dynamic = "force-dynamic";

const ROLE_LABELS: Record<string, string> = {
  admin: "an admin",
  member: "a member",
  viewer: "a viewer",
};

export default async function InvitePage({
  params,
}: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const tokenHash = await hashToken(token);

  const supabase = await supabaseSession();
  const { data: preview } = await supabase
    .rpc("invite_preview", { p_token_hash: tokenHash })
    .returns<{ workspace_name: string; role: string; valid: boolean }[]>()
    .maybeSingle();

  if (!preview) notFound();

  const nextPath = `/invite/${token}`;

  if (!preview.valid) {
    return (
      <div className="mx-auto flex max-w-sm flex-col gap-4 py-10 text-center">
        <h1 className="text-xl font-semibold text-text-primary">
          Invite no longer valid
        </h1>
        <p className="text-sm text-text-muted">
          This invite to {preview.workspace_name} has expired or was already
          used. Ask whoever sent it for a new one.
        </p>
      </div>
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="mx-auto flex max-w-sm flex-col gap-4 py-10 text-center">
      <h1 className="text-xl font-semibold text-text-primary">
        Join {preview.workspace_name}
      </h1>
      <p className="text-sm text-text-muted">
        You&apos;ve been invited to join as {ROLE_LABELS[preview.role] ?? preview.role}.
      </p>

      {user ? (
        <AcceptInviteButton token={token} />
      ) : (
        <div className="flex flex-col items-center gap-3">
          <Link
            href={`/login?next=${encodeURIComponent(nextPath)}`}
            className="min-h-11 w-full rounded-control bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground"
          >
            Sign in
          </Link>
          <Link
            href={`/signup?next=${encodeURIComponent(nextPath)}`}
            className="text-sm font-medium text-accent hover:underline"
          >
            Create an account
          </Link>
        </div>
      )}
    </div>
  );
}
