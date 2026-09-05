import Link from "next/link";
import { AuthBackdrop } from "../../components/auth/AuthBackdrop";
import { OneLedgerLogo } from "../../components/brand/OneLedgerLogo";
import { internalRedirectPath } from "../../lib/internal-redirect";
import { SignUpForm } from "./SignUpForm";

export const dynamic = "force-dynamic";

const BENEFITS = [
  "One place for every account, connected or manual",
  "Encrypted end to end - your data is never sold",
  "Free to start, no card required",
];

export default async function SignUpPage({
  searchParams,
}: PageProps<"/signup">) {
  const { next } = await searchParams;
  const nextPath = internalRedirectPath(typeof next === "string" ? next : null);

  return (
    <div className="relative mx-auto flex max-w-sm flex-col gap-6 py-10">
      <AuthBackdrop />
      <div className="text-center">
        <OneLedgerLogo height={40} className="mx-auto mb-5" />
        <h1 className="text-2xl font-semibold tracking-tight text-text-primary">
          Create your OneLedger account
        </h1>
        <p className="mt-1.5 text-sm text-text-muted">
          One secure place to connect accounts, organize your finances, and plan
          what comes next.
        </p>
      </div>
      <SignUpForm next={nextPath} />
      <ul className="flex flex-col gap-2 px-1">
        {BENEFITS.map((benefit) => (
          <li key={benefit} className="flex items-start gap-2 text-sm text-text-secondary">
            <svg
              aria-hidden
              viewBox="0 0 20 20"
              className="mt-0.5 h-4 w-4 shrink-0 text-money-positive"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m4 10 4 4 8-9" />
            </svg>
            <span>{benefit}</span>
          </li>
        ))}
      </ul>
      <p className="text-center text-sm text-text-muted">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-accent hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
