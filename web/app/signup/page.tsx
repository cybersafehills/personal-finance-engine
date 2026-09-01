import Link from "next/link";
import { OneLedgerLogo } from "../../components/brand/OneLedgerLogo";
import { SignUpForm } from "./SignUpForm";
import { internalRedirectPath } from "../../lib/internal-redirect";

export const dynamic = "force-dynamic";

export default async function SignUpPage({
  searchParams,
}: PageProps<"/signup">) {
  const { next } = await searchParams;
  const nextPath = internalRedirectPath(typeof next === "string" ? next : null);

  return (
    <div className="mx-auto flex max-w-sm flex-col gap-6 py-10">
      <div className="text-center">
        <OneLedgerLogo height={40} className="mx-auto mb-4" />
        <h1 className="text-xl font-semibold text-text-primary">
          Create your OneLedger account
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          One secure place to connect accounts, organize your finances, and plan
          what comes next.
        </p>
      </div>
      <SignUpForm next={nextPath} />
      <p className="text-center text-sm text-text-muted">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-accent hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
