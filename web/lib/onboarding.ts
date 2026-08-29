// Pure derivation of the "finish setting up" onboarding checklist.
// Step *completion* is always computed from live signals (never stored);
// only the user's dismissal of the reminder is persisted, by the caller
// (getOnboardingState in queries.ts). Deno-tested in onboarding_test.ts.

export type OnboardingStepKey =
  | "email_confirmed"
  | "account_added"
  | "connection_created"
  | "connection_live";

export type OnboardingStep = {
  key: OnboardingStepKey;
  title: string;
  /** Shown under the title. Present tense; no "you should". */
  description: string;
  done: boolean;
  /** CTA target for an incomplete step. */
  href: string;
  cta: string;
};

export type OnboardingInput = {
  emailConfirmed: boolean;
  accountCount: number;
  /** Connections with status 'active' (paused/revoked don't count). */
  activeConnectionCount: number;
  /** Connections that have received at least one message (last_used_at set). */
  liveConnectionCount: number;
};

export type OnboardingState = {
  steps: OnboardingStep[];
  doneCount: number;
  totalCount: number;
  complete: boolean;
  /** First not-done step — the "do this next" pointer. Null when complete. */
  nextStep: OnboardingStep | null;
};

export function deriveOnboardingState(input: OnboardingInput): OnboardingState {
  const steps: OnboardingStep[] = [
    {
      key: "email_confirmed",
      title: "Confirm your email",
      description:
        "Open the confirmation link we emailed you. Everything else works while you wait.",
      done: input.emailConfirmed,
      href: "/settings/security",
      cta: "View account",
    },
    {
      key: "account_added",
      title: "Add a financial account",
      description:
        "Your MTN MoMo or bank account. Transactions attach to it.",
      done: input.accountCount > 0,
      href: "/settings/accounts",
      cta: "Add account",
    },
    {
      key: "connection_created",
      title: "Connect a device",
      description:
        "Create a connection and copy its one-time key.",
      done: input.activeConnectionCount > 0,
      href: "/settings/connections",
      cta: "Connect a device",
    },
    {
      key: "connection_live",
      title: "Forward your first message",
      description:
        "Build the iPhone Shortcut and send a MoMo SMS. The connection turns “Ready” and transactions start flowing.",
      done: input.liveConnectionCount > 0,
      href: "/settings/connections/setup",
      cta: "Open the guide",
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;

  return {
    steps,
    doneCount,
    totalCount: steps.length,
    complete: doneCount === steps.length,
    nextStep: steps.find((s) => !s.done) ?? null,
  };
}
