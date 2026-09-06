import { redirect } from "next/navigation";
import { PageHeader } from "../../../components/PageHeader";
import { StepWizard } from "../../../components/ds/StepWizard";
import { FinancialPreferencesOnboardingForm } from "../../../components/FinancialPreferencesOnboardingForm";
import { getProfileOnboarding } from "../../../lib/queries";

export const dynamic = "force-dynamic";

export default async function OnboardingPreferencesPage() {
  const profile = await getProfileOnboarding();
  if (!profile) redirect("/login");
  // Only bounce back to step 1 if it genuinely isn't done. A cache/replication
  // lag right after saving step 1 can briefly still read step="profile" even
  // though the name is saved - don't trap the user on step 1 in that window.
  if (profile.step === "profile" && !profile.firstName.trim()) {
    redirect("/onboarding/profile");
  }
  if (profile.step === "setup") redirect("/onboarding");
  if (profile.step === "completed") redirect("/");

  return (
    <StepWizard steps={["Your details", "Preferences"]} current={1}>
      <PageHeader
        title="Set your financial preferences"
        subtitle="Confirm how OneLedger should format money, dates, and scheduled activity."
      />
      <FinancialPreferencesOnboardingForm initial={profile} />
    </StepWizard>
  );
}
