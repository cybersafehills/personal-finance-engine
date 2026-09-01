import { redirect } from "next/navigation";
import { PageHeader } from "../../../components/PageHeader";
import { FinancialPreferencesOnboardingForm } from "../../../components/FinancialPreferencesOnboardingForm";
import { getProfileOnboarding } from "../../../lib/queries";

export const dynamic = "force-dynamic";

export default async function OnboardingPreferencesPage() {
  const profile = await getProfileOnboarding();
  if (!profile) redirect("/login");
  if (profile.step === "profile") redirect("/onboarding/profile");
  if (profile.step === "setup") redirect("/get-started");
  if (profile.step === "completed") redirect("/");

  return <div className="mx-auto max-w-xl">
    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-accent">Step 2 of 2</p>
    <PageHeader title="Set your financial preferences" subtitle="Confirm how OneLedger should format money, dates, and scheduled activity." />
    <FinancialPreferencesOnboardingForm initial={profile} />
  </div>;
}

