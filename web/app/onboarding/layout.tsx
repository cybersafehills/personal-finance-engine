import { OnboardingTopBar } from "../../components/onboarding/OnboardingTopBar";

// First-run frame. The app header / bottom nav are already suppressed for
// `/onboarding/*` in AppShell (isFirstRunRoute); this adds the shared
// Back / Skip strip and a narrow, centred column so every step looks and
// behaves the same.
export default function OnboardingLayout(
  { children }: { children: React.ReactNode },
) {
  return (
    <div className="flex min-h-full flex-col">
      <OnboardingTopBar />
      <div className="mx-auto w-full max-w-xl px-4 pb-16 pt-2 sm:px-0">
        {children}
      </div>
    </div>
  );
}
