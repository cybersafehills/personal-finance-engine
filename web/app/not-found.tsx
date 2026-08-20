import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-card border border-border-subtle bg-surface px-6 py-12 text-center">
      <p className="text-base font-medium text-text-primary">
        We couldn&apos;t find that.
      </p>
      <Link
        href="/"
        className="mt-1 min-h-11 rounded-control bg-accent px-4 py-2 text-sm font-medium text-accent-foreground"
      >
        Back to Home
      </Link>
    </div>
  );
}
