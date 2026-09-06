import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// The intent choice is now the first screen of the linear /onboarding
// wizard (lib/onboarding-milestones group "intent"). This standalone
// route is kept only so older links / the milestone model's href resolve
// - it forwards into the wizard.
export default function OnboardingIntentPage() {
  redirect("/onboarding");
}
