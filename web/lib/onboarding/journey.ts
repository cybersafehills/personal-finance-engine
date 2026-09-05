import "server-only";

import { supabaseSession } from "../supabase-session-server";
import {
  deriveOnboardingJourney,
  type OnboardingIntent,
  type OnboardingJourney,
} from "../onboarding-milestones";

// Server reader for the onboarding milestone journey (ADR 0012). Collects
// the live signals + the three persisted milestones and hands them to the
// pure model. RLS-scoped throughout; performs no writes.
//
// Deploy-drift safe: the persisted milestone columns ship in
// 20261129000000, which (like every migration) deploys only after main CI
// is green - potentially after this code. A read that hits a not-yet-
// migrated database just treats the persisted milestones as "not yet",
// and every derived signal keeps working. The feature is also dark by
// default (ONBOARDING_JOURNEY_ENABLED).

export function isOnboardingJourneyEnabled(): boolean {
  return process.env.ONBOARDING_JOURNEY_ENABLED === "true";
}

const EMPTY_PERSISTED = {
  intent: null as OnboardingIntent | null,
  firstReviewAt: null as string | null,
  firstInsightAt: null as string | null,
};

async function readPersistedMilestones(
  supabase: Awaited<ReturnType<typeof supabaseSession>>,
  userId: string,
): Promise<typeof EMPTY_PERSISTED> {
  const { data, error } = await supabase
    .from("profiles")
    .select(
      "onboarding_intent, onboarding_first_review_at, onboarding_first_insight_at",
    )
    .eq("id", userId)
    .maybeSingle();

  // A column-missing error (pre-migration) or any other read failure is
  // non-fatal: the journey still renders from derived signals.
  if (error || !data) return EMPTY_PERSISTED;

  const row = data as {
    onboarding_intent: string | null;
    onboarding_first_review_at: string | null;
    onboarding_first_insight_at: string | null;
  };
  const intent = row.onboarding_intent;
  return {
    intent: intent === "personal" || intent === "household" ||
        intent === "business"
      ? intent
      : null,
    firstReviewAt: row.onboarding_first_review_at,
    firstInsightAt: row.onboarding_first_insight_at,
  };
}

export async function getOnboardingJourney(): Promise<OnboardingJourney> {
  const supabase = await supabaseSession();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return deriveOnboardingJourney({
      intent: null,
      sourceCount: 0,
      pairedDeviceCount: 0,
      verifiedConnectionCount: 0,
      realTransactionCount: 0,
      firstReviewAt: null,
      firstInsightAt: null,
    });
  }

  const [persisted, sources, connections, txns] = await Promise.all([
    readPersistedMilestones(supabase, user.id),
    supabase
      .from("financial_sources")
      .select("id", { count: "exact", head: true })
      .eq("owner_user_id", user.id),
    supabase
      .from("ingestion_connections")
      .select("status, last_used_at"),
    supabase
      .from("transactions")
      .select("id", { count: "exact", head: true }),
  ]);

  const conns = connections.data ?? [];

  return deriveOnboardingJourney({
    intent: persisted.intent,
    sourceCount: sources.count ?? 0,
    pairedDeviceCount: conns.filter((c) => c.status === "active").length,
    // A synthetic op:"test" or any authenticated delivery stamps
    // last_used_at (capture handler) - the connection has proven it can
    // reach OneLedger.
    verifiedConnectionCount: conns.filter((c) => c.last_used_at != null).length,
    realTransactionCount: txns.count ?? 0,
    firstReviewAt: persisted.firstReviewAt,
    firstInsightAt: persisted.firstInsightAt,
  });
}
