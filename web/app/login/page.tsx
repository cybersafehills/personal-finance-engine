import Link from "next/link";
import { AuthBackdrop } from "../../components/auth/AuthBackdrop";
import { OneLedgerLogo } from "../../components/brand/OneLedgerLogo";
import { internalRedirectPath } from "../../lib/internal-redirect";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: PageProps<"/login">) {
  const { next } = await searchParams;
  const nextPath = internalRedirectPath(typeof next === "string" ? next : null);

  return (
    <div className="relative mx-auto flex max-w-sm flex-col gap-6 py-10">
      <AuthBackdrop />
      <div className="text-center">
        <OneLedgerLogo height={40} className="mx-auto mb-5" />
        <h1 className="text-2xl font-semibold tracking-tight text-text-primary">Sign in</h1>
        <p className="mt-1.5 text-sm text-text-muted">
          Your personal finance workspace.
        </p>
      </div>
      <LoginForm next={nextPath} />
      <p className="text-center text-sm text-text-muted">
        No account yet?{" "}
        <Link
          href="/signup"
          className="font-medium text-accent hover:underline"
        >
          Create one
        </Link>
      </p>
    </div>
  );
}
