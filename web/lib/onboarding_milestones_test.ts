import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  deriveOnboardingJourney,
  type MilestoneSignals,
  ONBOARDING_MILESTONES,
} from "./onboarding-milestones.ts";

const NOTHING: MilestoneSignals = {
  intent: null,
  sourceCount: 0,
  pairedDeviceCount: 0,
  verifiedConnectionCount: 0,
  realTransactionCount: 0,
  firstReviewAt: null,
  firstInsightAt: null,
};

Deno.test("a brand-new user: 7 milestones, none done, next = choose intent", () => {
  const j = deriveOnboardingJourney(NOTHING);
  assertEquals(j.totalCount, 7);
  assertEquals(j.doneCount, 0);
  assertEquals(j.complete, false);
  assertEquals(j.nextStep?.key, "intent_selected");
  assertEquals(j.intent, null);
});

Deno.test("steps are stable in the milestone order and well-formed", () => {
  const j = deriveOnboardingJourney(NOTHING);
  assertEquals(j.steps.map((s) => s.key), [...ONBOARDING_MILESTONES]);
  for (const step of j.steps) {
    assert(step.title.length > 0);
    assert(step.description.length > 0);
    assert(step.href.startsWith("/"));
    assert(step.cta.length > 0);
  }
});

Deno.test("intent + source + paired device advances the pointer to the connection test", () => {
  const j = deriveOnboardingJourney({
    ...NOTHING,
    intent: "personal",
    sourceCount: 1,
    pairedDeviceCount: 1,
  });
  assertEquals(j.doneCount, 3);
  assertEquals(j.nextStep?.key, "connection_verified");
});

Deno.test("a milestone completed out of order still counts, pointer stays at the first gap", () => {
  // A manual first transaction before any device is paired.
  const j = deriveOnboardingJourney({
    ...NOTHING,
    intent: "personal",
    realTransactionCount: 3,
  });
  assertEquals(j.doneCount, 2); // intent + first_real_transaction
  assertEquals(j.nextStep?.key, "source_added");
  assertEquals(j.complete, false);
});

Deno.test("every signal present -> complete, no next step", () => {
  const j = deriveOnboardingJourney({
    intent: "household",
    sourceCount: 2,
    pairedDeviceCount: 1,
    verifiedConnectionCount: 1,
    realTransactionCount: 40,
    firstReviewAt: "2026-09-05T00:00:00Z",
    firstInsightAt: "2026-09-06T00:00:00Z",
  });
  assertEquals(j.doneCount, 7);
  assertEquals(j.complete, true);
  assertEquals(j.nextStep, null);
  assertEquals(j.intent, "household");
});

Deno.test("intent alone does not imply any downstream milestone", () => {
  const j = deriveOnboardingJourney({ ...NOTHING, intent: "business" });
  assertEquals(j.doneCount, 1);
  assertEquals(j.nextStep?.key, "source_added");
});
