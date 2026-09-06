import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "../../components/PageHeader";
import { StepWizard } from "../../components/ds/StepWizard";
import { IntentChoiceForm } from "../../components/IntentChoiceForm";
import { OnboardingConnectStep } from "../../components/onboarding/OnboardingConnectStep";
import { getAccounts, getProfileOnboarding } from "../../lib/queries";
import {
  getOnboardingJourney,
  isOnboardingJourneyEnabled,
} from "../../lib/onboarding/journey";
import {
  groupOnboardingJourney,
  ONBOARDING_GROUPS,
  type OnboardingGroupKey,
  type OnboardingIntent,
} from "../../lib/onboarding-milestones";
import { devicePairingV2Enabled } from "../../lib/pairing";

export const dynamic = "force-dynamic";

// The first-run product-setup wizard: four screens over the seven
// milestones (lib/onboarding-milestones groupOnboardingJourney), one at a
// time. Replaces the old /get-started checklist as the flow the user is
// routed through; /get-started stays as a thin "resume" entry.
export default async function OnboardingWizardPage(
  { searchParams }: PageProps<"/onboarding">,
) {
  // Flag off ⇒ the legacy checklist owns first-run.
  if (!isOnboardingJourneyEnabled()) redirect("/get-started");

  const profile = await getProfileOnboarding();
  if (!profile) redirect("/login");
  if (profile.step === "profile") redirect("/onboarding/profile");
  if (profile.step === "preferences") redirect("/onboarding/preferences");

  const journey = await getOnboardingJourney();
  const grouped = groupOnboardingJourney(journey);
  const query = await searchParams;

  const requested = typeof query.step === "string"
    ? (query.step as OnboardingGroupKey)
    : null;
  const requestedIndex = requested && ONBOARDING_GROUPS.includes(requested)
    ? ONBOARDING_GROUPS.indexOf(requested)
    : -1;

  // "all set" once every group is done and the user isn't explicitly
  // reviewing an earlier step.
  if (grouped.complete && requestedIndex === -1) {
    return <AllSet />;
  }

  const activeIndex = requestedIndex !== -1
    ? requestedIndex
    : Math.min(grouped.currentIndex, grouped.groups.length - 1);
  const group = grouped.groups[activeIndex];
  const labels = grouped.groups.map((g) => g.label);

  const prevKey = activeIndex > 0
    ? ONBOARDING_GROUPS[activeIndex - 1]
    : null;
  // A completed step gets a plain "Continue" that lets the server pick the
  // next incomplete one; an incomplete step is advanced by its own body.
  const showContinue = group.done && activeIndex < grouped.groups.length - 1;

  return (
    <StepWizard steps={labels} current={activeIndex}>
      <PageHeader title={group.title} subtitle={group.subtitle} />

      {group.milestones.length > 1 && (
        <ol className="mb-5 flex flex-col gap-1.5">
          {group.milestones.map((m) => (
            <li
              key={m.key}
              className="flex items-center gap-2 text-sm text-text-secondary"
            >
              <span
                aria-hidden="true"
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                  m.done
                    ? "bg-money-positive-bg text-money-positive"
                    : "bg-background text-text-muted"
                }`}
              >
                {m.done ? "✓" : "○"}
              </span>
              <span className={m.done ? "text-text-muted line-through" : ""}>
                {m.title}
              </span>
            </li>
          ))}
        </ol>
      )}

      <StepBody
        groupKey={group.key}
        intent={journey.intent}
        hasFirstTransaction={journey.steps.find((s) =>
          s.key === "first_real_transaction"
        )?.done ?? false}
      />

      <div className="mt-8 flex items-center justify-between gap-3 border-t border-border-subtle pt-4">
        {prevKey
          ? (
            <Link
              href={`/onboarding?step=${prevKey}`}
              className="min-h-9 rounded-control px-2 text-sm font-medium leading-9 text-text-secondary hover:text-text-primary"
            >
              ← Previous
            </Link>
          )
          : <span />}
        {showContinue && (
          <Link
            href="/onboarding"
            className="min-h-11 rounded-control bg-accent px-5 text-sm font-semibold leading-[2.75rem] text-accent-foreground"
          >
            Continue
          </Link>
        )}
      </div>
    </StepWizard>
  );
}

async function StepBody({
  groupKey,
  intent,
  hasFirstTransaction,
}: {
  groupKey: OnboardingGroupKey;
  intent: OnboardingIntent | null;
  hasFirstTransaction: boolean;
}) {
  if (groupKey === "intent") {
    return <IntentChoiceForm initial={intent} />;
  }

  if (groupKey === "connect") {
    const accounts = await getAccounts();
    const pairingEnabled = devicePairingV2Enabled(
      process.env.DEVICE_PAIRING_V2,
    );
    return (
      <OnboardingConnectStep
        accounts={accounts.filter((a) => a.is_active)}
        pairingEnabled={pairingEnabled}
        shortcutUrl={process.env.NEXT_PUBLIC_MOMO_SHORTCUT_URL?.trim() || null}
        captureShortcutUrl={process.env.NEXT_PUBLIC_MOMO_CAPTURE_SHORTCUT_URL
          ?.trim() || null}
        mtnSender={process.env.MOMO_SMS_SENDER?.trim() || null}
        androidCompanionUrl={process.env.NEXT_PUBLIC_ANDROID_COMPANION_URL
          ?.trim() || null}
      />
    );
  }

  if (groupKey === "activity") {
    return (
      <div className="flex flex-col gap-4 rounded-card border border-border-subtle bg-surface p-5 text-sm text-text-secondary">
        {hasFirstTransaction
          ? (
            <p>
              Your first transaction has arrived. Open your ledger and confirm
              its category once - that&apos;s the only review OneLedger asks
              of you.
            </p>
          )
          : (
            <p>
              Nothing yet. As soon as a supported transaction message reaches
              your connected phone, it lands here automatically - no action
              needed from you.
            </p>
          )}
        <div className="flex flex-wrap gap-3">
          <Link
            href="/transactions"
            className="min-h-11 rounded-control bg-accent px-4 text-sm font-semibold leading-[2.75rem] text-accent-foreground"
          >
            Open my ledger
          </Link>
          <Link
            href="/inbox"
            className="min-h-11 rounded-control border border-border-strong px-4 text-sm font-medium leading-[2.75rem] text-text-primary"
          >
            Open the Inbox
          </Link>
        </div>
      </div>
    );
  }

  // insight
  return (
    <div className="flex flex-col gap-4 rounded-card border border-border-subtle bg-surface p-5 text-sm text-text-secondary">
      <p>
        Once there&apos;s a little activity, OneLedger shows a first read on
        where your money is going - on your Home screen and in Daily reports.
        Nothing to set up here.
      </p>
      <Link
        href="/"
        className="min-h-11 w-fit rounded-control bg-accent px-4 text-sm font-semibold leading-[2.75rem] text-accent-foreground"
      >
        Go to Home
      </Link>
    </div>
  );
}

function AllSet() {
  return (
    <StepWizard steps={["Intent", "Connect", "First activity", "Insight"]}
      current={4}>
      <PageHeader
        title="You're all set"
        subtitle="Your activity flows into OneLedger and is organized automatically. You can revisit any of this from Settings."
      />
      <Link
        href="/"
        className="mt-2 inline-flex min-h-11 items-center rounded-control bg-accent px-5 text-sm font-semibold text-accent-foreground"
      >
        Go to Home
      </Link>
    </StepWizard>
  );
}
