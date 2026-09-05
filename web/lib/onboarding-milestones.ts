// Release 3 (First Run): the onboarding milestone journey (ADR 0012).
//
// A durable, resumable state machine over seven milestones. Most are
// DERIVED from live signals so they survive a reinstall, a new device, or
// clearing browser storage with no stored state; the three that cannot be
// observed from data (the user's intent, that they acted on the first
// review, that they saw the first insight) are persisted on `profiles`
// (20261129000000). This module is pure - the server reader
// (lib/onboarding/journey.ts) collects the signals; here we turn them into
// an ordered checklist with a single "do this next" pointer.
//
// Steps can complete out of order where that is safe (a manual first
// transaction before any device is paired, say) - `done` is per-signal,
// and `nextStep` is simply the first not-done step.

export const ONBOARDING_MILESTONES = [
  "intent_selected",
  "source_added",
  "device_paired",
  "connection_verified",
  "first_real_transaction",
  "first_review_completed",
  "first_insight_seen",
] as const;

export type OnboardingMilestone = (typeof ONBOARDING_MILESTONES)[number];

export type OnboardingIntent = "personal" | "household" | "business";

export type MilestoneSignals = {
  /** Persisted: the user's Personal / Household / Business choice. */
  intent: OnboardingIntent | null;
  /** Derived: financial sources the user owns. */
  sourceCount: number;
  /** Derived: paired capture devices / active ingestion connections. */
  pairedDeviceCount: number;
  /**
   * Derived: connections that have proven they can reach OneLedger - a
   * successful synthetic `op:"test"` (capture handler) or any authenticated
   * delivery has stamped last_used_at / last_success_at.
   */
  verifiedConnectionCount: number;
  /** Derived: real (non-synthetic) transactions in the ledger. */
  realTransactionCount: number;
  /** Persisted: acted on the first-transaction review card. */
  firstReviewAt: string | null;
  /** Persisted: saw their first insight. */
  firstInsightAt: string | null;
};

export type MilestoneStep = {
  key: OnboardingMilestone;
  title: string;
  /** Present tense, customer language, no "you should". */
  description: string;
  done: boolean;
  /** Where an incomplete step sends the user. */
  href: string;
  cta: string;
};

export type OnboardingJourney = {
  steps: MilestoneStep[];
  doneCount: number;
  totalCount: number;
  complete: boolean;
  /** First not-done step. Null once every milestone is met. */
  nextStep: MilestoneStep | null;
  intent: OnboardingIntent | null;
};

export function deriveOnboardingJourney(
  signals: MilestoneSignals,
): OnboardingJourney {
  const steps: MilestoneStep[] = [
    {
      key: "intent_selected",
      title: "Choose how you'll use OneLedger",
      description:
        "Personal, Household, or Business - this shapes what you see.",
      done: signals.intent !== null,
      href: "/onboarding/intent",
      cta: "Choose",
    },
    {
      key: "source_added",
      title: "Add a financial source",
      description:
        "Your MTN MoMo line or a bank account - where your activity comes from.",
      done: signals.sourceCount > 0,
      href: "/settings/sources",
      cta: "Add a source",
    },
    {
      key: "device_paired",
      title: "Connect this phone",
      description:
        "So OneLedger can securely receive your supported financial notifications.",
      done: signals.pairedDeviceCount > 0,
      href: "/pair",
      cta: "Pair a device",
    },
    {
      key: "connection_verified",
      title: "Check the connection",
      description:
        "A quick test proves the connection works - it never touches your ledger.",
      done: signals.verifiedConnectionCount > 0,
      href: "/pair",
      cta: "Run the test",
    },
    {
      key: "first_real_transaction",
      title: "See your first transaction",
      description:
        "Once a real transaction arrives, OneLedger sorts it into your ledger.",
      done: signals.realTransactionCount > 0,
      href: "/transactions",
      cta: "View activity",
    },
    {
      key: "first_review_completed",
      title: "Review one transaction",
      description:
        "Confirm or fix its category once, and OneLedger learns your preference.",
      done: signals.firstReviewAt !== null,
      href: "/inbox",
      cta: "Open the Inbox",
    },
    {
      key: "first_insight_seen",
      title: "See your first insight",
      description:
        "A first read on where your money is going, once there's enough activity.",
      done: signals.firstInsightAt !== null,
      href: "/",
      cta: "Go to Home",
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;

  return {
    steps,
    doneCount,
    totalCount: steps.length,
    complete: doneCount === steps.length,
    nextStep: steps.find((s) => !s.done) ?? null,
    intent: signals.intent,
  };
}
