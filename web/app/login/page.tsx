import Link from "next/link";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: PageProps<"/login">) {
  const { next } = await searchParams;
  const nextPath = typeof next === "string" ? next : "/";

  return (
    <div className="mx-auto flex max-w-sm flex-col gap-6 py-10">
      <div className="text-center">
        <h1 className="text-xl font-semibold text-text-primary">Sign in</h1>
        <p className="mt-1 text-sm text-text-muted">
          Your personal finance workspace.
        </p>
      </div>
      <LoginForm next={nextPath} />
      <p className="text-center text-sm text-text-muted">
        No account yet?{" "}
        <Link href="/signup" className="font-medium text-accent hover:underline">
          Create one
        </Link>
      </p>
    </div>
  );
}
