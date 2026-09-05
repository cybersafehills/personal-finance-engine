// The shared multi-step-flow chrome (master prompt "StepWizard" /
// assessment section 6.1). Onboarding, device pairing, source setup, and
// connector setup all present "step N of M" the same way. This renders
// the progress header only; the step body is `children`, owned by the
// caller. It is intentionally presentational and uncontrolled - the
// caller holds the current-step state (often derived from persisted
// milestones, not local state).

export function StepWizard({
  steps,
  current,
  title,
  children,
}: {
  /** Ordered short step labels, e.g. ["Account", "Install", "Pair", "Verify"]. */
  steps: readonly string[];
  /** Zero-based index of the active step. Values >= steps.length mean "done". */
  current: number;
  title?: string;
  children: React.ReactNode;
}) {
  const total = steps.length;
  const done = current >= total;
  const activeLabel = done ? "Done" : steps[current];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        {title && (
          <h1 className="text-xl font-semibold tracking-tight text-text-primary">
            {title}
          </h1>
        )}
        <p
          className="text-sm text-text-muted"
          aria-live="polite"
        >
          {done
            ? "All steps complete"
            : `Step ${current + 1} of ${total}: ${activeLabel}`}
        </p>
        <ol className="flex items-center gap-1.5" aria-hidden="true">
          {steps.map((label, i) => {
            const state = done || i < current
              ? "complete"
              : i === current
              ? "active"
              : "upcoming";
            return (
              <li
                key={label}
                className={`h-1.5 flex-1 rounded-full ${
                  state === "complete"
                    ? "bg-money-positive"
                    : state === "active"
                    ? "bg-accent"
                    : "bg-border-subtle"
                }`}
              />
            );
          })}
        </ol>
      </div>
      {children}
    </div>
  );
}
