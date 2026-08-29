import Link from "next/link";
import { redirect } from "next/navigation";
import { getOnboardingState } from "../../lib/queries";
import { PageHeader } from "../../components/PageHeader";
import { DismissOnboardingButton } from "../../components/DismissOnboardingButton";

export const dynamic = "force-dynamic";

export default async function GetStartedPage() {
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
        subtitle="Four steps to get your MoMo transactions flowing in"
      />

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
            href="/settings/connections/setup"
            className="font-medium text-accent hover:underline"
          >
            step-by-step setup guide
          </Link>
          .
        </p>
        {!complete && (
          <DismissOnboardingButton
            label="Hide this checklist"
            className="w-fit min-h-8 text-xs font-medium text-text-muted hover:text-text-primary"
          />
        )}
      </div>
    </div>
  );
}
