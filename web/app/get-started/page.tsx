import Link from "next/link";
import { redirect } from "next/navigation";
import { getOnboardingState, getProfileOnboarding } from "../../lib/queries";
import {
  getOnboardingJourney,
  isOnboardingJourneyEnabled,
} from "../../lib/onboarding/journey";
import { PageHeader } from "../../components/PageHeader";
import { DismissOnboardingButton } from "../../components/DismissOnboardingButton";
import { OnboardingChoiceLink } from "../../components/OnboardingChoiceLink";

export const dynamic = "force-dynamic";

export default async function GetStartedPage() {
  const profile = await getProfileOnboarding();
  if (profile?.step === "profile") redirect("/onboarding/profile");
  if (profile?.step === "preferences") redirect("/onboarding/preferences");

  // Release 3 (ADR 0012): when the milestone journey is on, this page is
  // the ordered journey - customer language, one step at a time, no raw
  // "create a connection" choices.
  if (isOnboardingJourneyEnabled()) {
    const journey = await getOnboardingJourney();
    return (
      <div>
        <PageHeader
          title="Get started"
          subtitle="A few steps to a ledger you can trust. Pick up wherever you left off."
        />
        <p className="mb-4 text-sm text-text-muted">
          {journey.doneCount} of {journey.totalCount} done
        </p>
        {journey.complete
          ? (
            <div className="flex flex-col gap-3 rounded-card border border-border-subtle bg-surface p-5">
              <p className="text-sm font-medium text-text-primary">
                You&apos;re all set. Your activity flows into OneLedger and
                is organized automatically.
              </p>
              <Link
                href="/"
                className="min-h-9 w-fit rounded-control bg-accent px-3 text-xs font-medium leading-9 text-accent-foreground"
              >
                Go to Home
              </Link>
            </div>
          )
          : (
            <ol className="flex flex-col gap-3">
              {journey.steps.map((step, i) => (
                <li
                  key={step.key}
                  className="flex gap-3 rounded-card border border-border-subtle bg-surface p-4"
                >
                  <span
                    aria-hidden="true"
                    className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                      step.done
                        ? "bg-money-positive-bg text-money-positive"
                        : "bg-background text-text-muted"
                    }`}
                  >
                    {step.done ? "✓" : i + 1}
                  </span>
                  <div className="flex flex-1 flex-col gap-1">
                    <span className="text-sm font-medium text-text-primary">
                      {step.title}
                      {step.done && (
                        <span className="ml-2 text-xs font-normal text-money-positive">
                          Done
                        </span>
                      )}
                    </span>
                    <span className="text-xs text-text-muted">
                      {step.description}
                    </span>
                    {!step.done && (
                      <Link
                        href={step.href}
                        className="mt-1 min-h-8 w-fit rounded-control bg-accent px-3 text-xs font-medium leading-8 text-accent-foreground"
                      >
                        {step.cta}
                      </Link>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        <div className="mt-6 flex flex-wrap items-center gap-4">
          <Link
            href="/onboarding/review"
            className="min-h-8 text-xs font-medium leading-8 text-accent hover:underline"
          >
            See your setup summary
          </Link>
          {!journey.complete && (
            <DismissOnboardingButton
              label="Dismiss setup reminder"
              className="w-fit min-h-8 text-xs font-medium text-text-muted hover:text-text-primary"
            />
          )}
        </div>
      </div>
    );
  }

  const snapshot = await getOnboardingState();

  // Flag off (or workspace not on the allowlist): no checklist here -
  // fall through to the dashboard rather than 404, so an auth-callback
  // redirect to this route is always safe.
  if (!snapshot.enabled) redirect("/");

  const { steps, doneCount, totalCount, complete } = snapshot;

  return (
    <div>
      <PageHeader
        title="Get started"
        subtitle="Choose a quick start, or finish setup at your own pace"
      />

      {!complete && (
        <section
          aria-labelledby="quick-start-heading"
          className="mb-6 rounded-card border border-border-subtle bg-surface p-4"
        >
          <h2
            id="quick-start-heading"
            className="text-base font-semibold text-text-primary"
          >
            How would you like to begin?
          </h2>
          <p className="mt-1 text-sm text-text-muted">
            Pick any option now. You can return to the others from Settings.
          </p>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <OnboardingChoiceLink
              href="/integrations/connections/setup"
            >
              <span className="block text-sm font-medium text-text-primary">
                Link a device
              </span>
              <span className="mt-1 block text-xs text-text-muted">
                Follow the phone and Shortcut setup guide.
              </span>
            </OnboardingChoiceLink>
            <OnboardingChoiceLink
              href="/integrations/connections"
            >
              <span className="block text-sm font-medium text-text-primary">
                Create a connection
              </span>
              <span className="mt-1 block text-xs text-text-muted">
                Connect a provider or a transaction-forwarding device.
              </span>
            </OnboardingChoiceLink>
            <OnboardingChoiceLink
              href="/transactions/new"
            >
              <span className="block text-sm font-medium text-text-primary">
                Start using OneLedger
              </span>
              <span className="mt-1 block text-xs text-text-muted">
                Add a transaction manually and explore the platform.
              </span>
            </OnboardingChoiceLink>
          </div>

          <DismissOnboardingButton
            label="Do it later in Settings"
            hrefAfterDismiss="/settings"
            className="mt-4 min-h-11 rounded-control px-2 text-sm font-medium text-text-muted hover:text-text-primary"
          />
        </section>
      )}

      <p className="mb-4 text-sm text-text-muted">{doneCount} of {totalCount} done</p>

      {complete
        ? (
          <div className="flex flex-col gap-3 rounded-card border border-border-subtle bg-surface p-5">
            <p className="text-sm font-medium text-text-primary">
              You&apos;re all set. Transactions forwarded from your device
              now appear automatically.
            </p>
            <Link
              href="/"
              className="min-h-9 w-fit rounded-control bg-accent px-3 text-xs font-medium leading-9 text-accent-foreground"
            >
              Go to your dashboard
            </Link>
          </div>
        )
        : (
          <ol className="flex flex-col gap-3">
            {steps.map((step, i) => (
              <li
                key={step.key}
                className="flex gap-3 rounded-card border border-border-subtle bg-surface p-4"
              >
                <span
                  aria-hidden="true"
                  className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                    step.done
                      ? "bg-money-positive-bg text-money-positive"
                      : "bg-background text-text-muted"
                  }`}
                >
                  {step.done ? "✓" : i + 1}
                </span>
                <div className="flex flex-1 flex-col gap-1">
                  <span className="text-sm font-medium text-text-primary">
                    {step.title}
                    {step.done && (
                      <span className="ml-2 text-xs font-normal text-money-positive">
                        Done
                      </span>
                    )}
                  </span>
                  <span className="text-xs text-text-muted">
                    {step.description}
                  </span>
                  {!step.done && (
                    <Link
                      href={step.href}
                      className="mt-1 min-h-8 w-fit rounded-control bg-accent px-3 text-xs font-medium leading-8 text-accent-foreground"
                    >
                      {step.cta}
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}

      <div className="mt-6 flex flex-col gap-2 text-xs text-text-muted">
        <p>
          Stuck on the Shortcut? See the{" "}
          <Link
            href="/integrations/connections/setup"
            className="font-medium text-accent hover:underline"
          >
            step-by-step setup guide
          </Link>
          .
        </p>
        {!complete && (
          <DismissOnboardingButton
            label="Dismiss setup reminder"
            className="w-fit min-h-8 text-xs font-medium text-text-muted hover:text-text-primary"
          />
        )}
      </div>
    </div>
  );
}
