import { redirect } from "next/navigation";
import { PageHeader } from "../../../components/PageHeader";
import { StepWizard } from "../../../components/ds/StepWizard";
import { ProfileOnboardingForm } from "../../../components/ProfileOnboardingForm";
import { getProfileOnboarding } from "../../../lib/queries";

export const dynamic = "force-dynamic";

export default async function OnboardingProfilePage() {
  const profile = await getProfileOnboarding();
  if (!profile) redirect("/login");
  if (profile.step === "setup") redirect("/onboarding");
  if (profile.step === "completed") redirect("/");

  return (
    <StepWizard steps={["Your details", "Preferences"]} current={0}>
      <PageHeader
        title="What should we call you?"
        subtitle="A few basics help OneLedger set up your personal financial space."
      />
      <ProfileOnboardingForm initial={profile} />
    </StepWizard>
  );
}
