import Link from "next/link";
import { SignUpForm } from "./SignUpForm";

export const dynamic = "force-dynamic";

export default function SignUpPage() {
  return (
    <div className="mx-auto flex max-w-sm flex-col gap-6 py-10">
      <div className="text-center">
        <h1 className="text-xl font-semibold text-text-primary">
          Create your account
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          Sets up your own personal finance workspace.
        </p>
      </div>
      <SignUpForm />
      <p className="text-center text-sm text-text-muted">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-accent hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
