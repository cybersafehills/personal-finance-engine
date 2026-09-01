"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { dismissOnboardingChecklist } from "../app/get-started/actions";

/**
 * Dismisses the onboarding checklist reminder. Used by the dashboard
 * nudge and the /get-started page. Dismissing only hides the reminder -
 * the steps stay reachable at /get-started, and re-appear nowhere else.
 */
export function DismissOnboardingButton({
  label = "Dismiss",
  hrefAfterDismiss,
  className = "min-h-8 text-xs font-medium text-text-muted hover:text-text-primary",
}: {
  label?: string;
  /** Optional destination for explicit "set up later" actions. */
  hrefAfterDismiss?: string;
  className?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          const result = await dismissOnboardingChecklist();
          if (result.ok && hrefAfterDismiss) {
            router.push(hrefAfterDismiss);
            return;
          }
          router.refresh();
        })}
      className={`${className} disabled:opacity-50`}
    >
      {label}
    </button>
  );
}
