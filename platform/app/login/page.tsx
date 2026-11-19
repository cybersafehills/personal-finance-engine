import Image from "next/image";
import { signIn } from "./actions";

export const metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <div className="rounded-card border border-border bg-surface p-6 shadow-card">
        <div className="mb-5 flex items-center gap-3">
          <Image src="/brand/mark.png" alt="" width={36} height={36} priority />
          <div>
            <h1 className="text-base font-semibold">OneLedger Platform Console</h1>
            <p className="text-xs text-text-3">Authorised staff only</p>
          </div>
        </div>
        <form action={signIn} className="space-y-3">
          <label className="block text-sm">
            <span className="mb-1 block text-text-2">Email</span>
            <input
              name="email"
              type="email"
              autoComplete="username"
              required
              className="w-full rounded-control border border-border-strong bg-surface px-3 py-2 text-sm"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-text-2">Password</span>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="w-full rounded-control border border-border-strong bg-surface px-3 py-2 text-sm"
            />
          </label>
          {error ? (
            <p role="alert" className="rounded-control bg-danger-soft px-3 py-2 text-sm text-danger">
              Sign-in failed. Check your details and try again.
            </p>
          ) : null}
          <button
            type="submit"
            className="w-full rounded-control bg-accent px-3 py-2 text-sm font-medium text-accent-fg hover:opacity-90"
          >
            Continue
          </button>
        </form>
        <p className="mt-4 text-xs text-text-3">
          Multi-factor authentication is required for every console session.
        </p>
      </div>
    </main>
  );
}
