import Link from "next/link";

export function PageHeader({
  title,
  subtitle,
  action,
  backHref,
  backLabel = "Back",
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  /** Renders a "← Back" link above the title - use on any subpage reached by drilling in, so there's always an in-page way back besides the bottom nav. */
  backHref?: string;
  backLabel?: string;
}) {
  return (
    <div className="mb-4 flex flex-col gap-3">
      {backHref && (
        <Link
          href={backHref}
          className="inline-flex w-fit items-center gap-1 text-sm font-medium text-accent hover:underline"
        >
          <span aria-hidden="true">←</span> {backLabel}
        </Link>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-text-primary">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-0.5 text-sm text-text-muted">{subtitle}</p>
          )}
        </div>
        {action}
      </div>
    </div>
  );
}
