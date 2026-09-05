import { redirect } from "next/navigation";
import { PageHeader } from "../../../components/PageHeader";
import { StepWizard } from "../../../components/ds/StepWizard";
import { IntentChoiceForm } from "../../../components/IntentChoiceForm";
import {
  getOnboardingJourney,
  isOnboardingJourneyEnabled,
} from "../../../lib/onboarding/journey";

export const dynamic = "force-dynamic";

// Release 3 (First Run) - the intent step. First real decision of the
// milestone journey (ADR 0012): Personal / Household / Business, which
// shapes the experience mode (ADR 0011). Dark until
// ONBOARDING_JOURNEY_ENABLED; when off, this route sends the user to the
// existing get-started flow.
export default async function OnboardingIntentPage() {
  if (!isOnboardingJourneyEnabled()) redirect("/get-started");

  const journey = await getOnboardingJourney();

  return (
    <div className="mx-auto max-w-xl">
      <StepWizard steps={["Intent", "Source", "Connect", "Verify"]} current={0}>
        <PageHeader
          title="How will you use OneLedger?"
          subtitle="Connect your financial activity and OneLedger organizes it into one trustworthy ledger, shows what needs your attention, and helps you see where your money goes."
        />
        <IntentChoiceForm initial={journey.intent} />
      </StepWizard>
    </div>
  );
}
