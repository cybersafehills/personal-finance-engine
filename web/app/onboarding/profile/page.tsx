import { redirect } from "next/navigation";
import { PageHeader } from "../../../components/PageHeader";
import { ProfileOnboardingForm } from "../../../components/ProfileOnboardingForm";
import { getProfileOnboarding } from "../../../lib/queries";

export const dynamic = "force-dynamic";

export default async function OnboardingProfilePage() {
  const profile = await getProfileOnboarding();
  if (!profile) redirect("/login");
  if (profile.step === "setup") redirect("/get-started");
  if (profile.step === "completed") redirect("/");

  return <div className="mx-auto max-w-xl">
    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-accent">Step 1 of 2</p>
    <PageHeader title="What should we call you?" subtitle="A few basics help OneLedger configure your personal financial space." />
    <ProfileOnboardingForm initial={profile} />
  </div>;
}

