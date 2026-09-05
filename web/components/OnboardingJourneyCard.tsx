import Link from "next/link";
import type { OnboardingJourney } from "../lib/onboarding-milestones";
import { DismissOnboardingButton } from "./DismissOnboardingButton";

// The dashboard checklist for the milestone journey (ADR 0012). Replaces
// the derived-only "Finish setting up" nudge when ONBOARDING_JOURNEY_
// ENABLED is on. Compact: progress, the one next action, the remaining
// steps in order, and a way out. Dismissing only hides it - the steps
// stay reachable, and progress keeps advancing from live signals.

export function OnboardingJourneyCard({
  journey,
}: {
  journey: OnboardingJourney;
}) {
  const { doneCount, totalCount, nextStep, steps } = journey;
  const remaining = steps.filter((s) => !s.done && s.key !== nextStep?.key);

  return (
    <section
      aria-label="Get started with OneLedger"
      className="flex flex-col gap-3 rounded-card border border-border-subtle bg-surface p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-text-primary">
          Get started
        </h2>
        <span className="text-xs text-text-muted">
          {doneCount} of {totalCount}
        </span>
      </div>

      <div
        className="h-1.5 overflow-hidden rounded-full bg-background"
        role="progressbar"
        aria-label="Onboarding progress"
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

      <div className="flex flex-wrap items-center gap-3 pt-0.5">
        {nextStep && (
          <Link
            href={nextStep.href}
            className="min-h-9 rounded-control bg-accent px-3 text-xs font-medium leading-9 text-accent-foreground"
          >
            {nextStep.cta}
          </Link>
        )}
        <DismissOnboardingButton className="min-h-9 text-xs font-medium leading-9 text-text-muted hover:text-text-primary" />
      </div>

      {remaining.length > 0 && (
        <ol className="mt-0.5 flex flex-col gap-1 border-t border-border-subtle pt-2">
          {remaining.map((step) => (
            <li
              key={step.key}
              className="flex items-baseline gap-2 text-xs text-text-muted"
            >
              <span aria-hidden="true">○</span>
              <span>{step.title}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
