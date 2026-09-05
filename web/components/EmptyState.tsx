// The empty / setup state (assessment section 6.1, master prompt
// "EmptyState / SetupState"). A good empty state answers three things:
// what this surface is for, why it matters, and the next meaningful
// action - so it takes an optional `action` and can render as a
// higher-emphasis `variant="setup"` card when the next step is the whole
// point of the screen (Sources with no source, Budgets with no budget).
//
// All new props are optional: `<EmptyState title=… />` still works
// everywhere it already did.

export function EmptyState({
  title,
  description,
  action,
  icon,
  variant = "plain",
}: {
  title: string;
  description?: string;
  /** A primary next-step control - usually a <Link>/<button>. */
  action?: React.ReactNode;
  icon?: React.ReactNode;
  variant?: "plain" | "setup";
}) {
  const inner = (
    <div className="flex flex-col items-center gap-1.5 text-center">
      {icon && (
        <div className="mb-1 text-text-muted" aria-hidden="true">{icon}</div>
      )}
      <p className="text-sm font-medium text-text-secondary">{title}</p>
      {description && <p className="text-sm text-text-muted">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );

  if (variant === "setup") {
    return (
      <div className="rounded-card border border-border-subtle bg-surface px-4 py-10">
        {inner}
      </div>
    );
  }

  return <div className="px-4 py-12">{inner}</div>;
}
