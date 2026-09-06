import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "../../../components/PageHeader";
import {
  getOnboardingJourney,
  isOnboardingJourneyEnabled,
} from "../../../lib/onboarding/journey";
import { trackOnboardingEvent } from "../../../lib/onboarding/analytics";

export const dynamic = "force-dynamic";

// Release 3 (First Run) - the setup review screen (master prompt section
// 19 / section 107). A single "here is what's ready" summary before the
// user heads to Home: every milestone shown as ready or "set up later",
// no shaming, one clear way forward. Reads the same milestone journey as
// /get-started and the dashboard card (ADR 0012) - it renders, never
// writes. Dark until ONBOARDING_JOURNEY_ENABLED; when off this route
// sends the user to the existing get-started flow, like /onboarding/intent.
export default async function OnboardingReviewPage() {
  if (!isOnboardingJourneyEnabled()) redirect("/get-started");

  const journey = await getOnboardingJourney();
  trackOnboardingEvent("setup_review_viewed", {
    doneCount: journey.doneCount,
    complete: journey.complete,
  });

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader
        title="Your OneLedger setup"
        subtitle={
          journey.complete
            ? "Everything's ready. Your activity flows in and is organized automatically."
            : "Here's what's ready so far. You can finish the rest whenever it suits you."
        }
      />

      <p className="mb-4 text-sm text-text-muted">
        {journey.doneCount} of {journey.totalCount} ready
      </p>

      <ul className="flex flex-col gap-2">
        {journey.steps.map((step) => (
          <li
            key={step.key}
            className="flex items-start gap-3 rounded-card border border-border-subtle bg-surface p-4"
          >
            <span
              aria-hidden="true"
              className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                step.done
                  ? "bg-money-positive-bg text-money-positive"
                  : "bg-background text-text-muted"
              }`}
            >
              {step.done ? "✓" : "○"}
            </span>
            <div className="flex flex-1 flex-col gap-0.5">
              <span className="text-sm font-medium text-text-primary">
                {step.title}
              </span>
              <span className="text-xs text-text-muted">
                {step.done ? step.description : "Set up later"}
              </span>
            </div>
            {!step.done && (
              <Link
                href={step.href}
                className="shrink-0 self-center text-xs font-medium text-accent hover:underline"
              >
                {step.cta}
              </Link>
            )}
          </li>
        ))}
      </ul>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Link
          href="/"
          className="min-h-9 rounded-control bg-accent px-4 text-xs font-medium leading-9 text-accent-foreground"
        >
          Go to Home
        </Link>
        {!journey.complete && (
          <Link
            href="/get-started"
            className="min-h-9 text-xs font-medium leading-9 text-text-muted hover:text-text-primary"
          >
            Finish setup
          </Link>
        )}
      </div>
    </div>
  );
}
