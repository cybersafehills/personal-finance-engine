import Link from "next/link";
import type { OnboardingSnapshot } from "../lib/queries";
import { DismissOnboardingButton } from "./DismissOnboardingButton";

/**
 * The dashboard nudge, shown only while `snapshot.showNudge` is true
 * (flag on, not dismissed, not complete). Compact: progress, the single
 * next action, and a way out. The full walkthrough is /get-started.
 */
export function OnboardingCard({ snapshot }: { snapshot: OnboardingSnapshot }) {
  const { doneCount, totalCount, nextStep } = snapshot;

  return (
    <section
      aria-label="Finish setting up"
      className="flex flex-col gap-3 rounded-card border border-border-subtle bg-surface p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-text-primary">
          Finish setting up
        </h2>
        <span className="text-xs text-text-muted">
          {doneCount} of {totalCount} done
        </span>
      </div>

      <div
        className="h-1.5 overflow-hidden rounded-full bg-background"
        role="progressbar"
        aria-valuenow={doneCount}
        aria-valuemin={0}
        aria-valuemax={totalCount}
      >
        <div
          className="h-full rounded-full bg-accent transition-[width]"
          style={{ width: `${(doneCount / totalCount) * 100}%` }}
        />
      </div>

      {nextStep && (
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-text-primary">
            Next: {nextStep.title}
          </p>
          <p className="text-xs text-text-muted">{nextStep.description}</p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 pt-1">
        {nextStep && (
          <Link
            href={nextStep.href}
            className="min-h-9 rounded-control bg-accent px-3 text-xs font-medium leading-9 text-accent-foreground"
          >
            {nextStep.cta}
          </Link>
        )}
        <Link
          href="/get-started"
          className="min-h-9 text-xs font-medium leading-9 text-accent hover:underline"
        >
          See all steps
        </Link>
        <DismissOnboardingButton className="min-h-9 text-xs font-medium leading-9 text-text-muted hover:text-text-primary" />
      </div>
    </section>
  );
}
