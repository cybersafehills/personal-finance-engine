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

// ---------------------------------------------------------------------------
// groupOnboardingJourney: the four wizard screens over the seven milestones.
// ---------------------------------------------------------------------------

import {
  groupOnboardingJourney,
  ONBOARDING_GROUPS,
} from "./onboarding-milestones.ts";

Deno.test("grouping: brand-new user -> 4 groups, none done, current = intent (0)", () => {
  const g = groupOnboardingJourney(deriveOnboardingJourney(NOTHING));
  assertEquals(g.totalCount, 4);
  assertEquals(g.doneCount, 0);
  assertEquals(g.complete, false);
  assertEquals(g.currentIndex, 0);
  assertEquals(g.groups.map((x) => x.key), [...ONBOARDING_GROUPS]);
});

Deno.test("grouping: intent chosen -> group 0 done, current = connect (1)", () => {
  const g = groupOnboardingJourney(
    deriveOnboardingJourney({ ...NOTHING, intent: "personal" }),
  );
  assertEquals(g.groups[0].done, true);
  assertEquals(g.doneCount, 1);
  assertEquals(g.currentIndex, 1);
});

Deno.test("grouping: connect group needs ALL of source+device+verified", () => {
  const partial = groupOnboardingJourney(deriveOnboardingJourney({
    ...NOTHING,
    intent: "personal",
    sourceCount: 1,
    pairedDeviceCount: 1,
    verifiedConnectionCount: 0,
  }));
  assertEquals(partial.groups[1].done, false);
  assertEquals(partial.currentIndex, 1);

  const full = groupOnboardingJourney(deriveOnboardingJourney({
    ...NOTHING,
    intent: "personal",
    sourceCount: 1,
    pairedDeviceCount: 1,
    verifiedConnectionCount: 1,
  }));
  assertEquals(full.groups[1].done, true);
  assertEquals(full.currentIndex, 2);
});

Deno.test("grouping: every milestone done -> complete, currentIndex past the end", () => {
  const g = groupOnboardingJourney(deriveOnboardingJourney({
    intent: "household",
    sourceCount: 2,
    pairedDeviceCount: 1,
    verifiedConnectionCount: 1,
    realTransactionCount: 5,
    firstReviewAt: "2026-09-05T00:00:00Z",
    firstInsightAt: "2026-09-06T00:00:00Z",
  }));
  assertEquals(g.complete, true);
  assertEquals(g.doneCount, 4);
  assertEquals(g.currentIndex, 4);
});

Deno.test("grouping: all seven milestones are covered exactly once", () => {
  const g = groupOnboardingJourney(deriveOnboardingJourney(NOTHING));
  const covered = g.groups.flatMap((x) => x.milestones.map((m) => m.key)).sort();
  assertEquals(covered, [...ONBOARDING_MILESTONES].sort());
});
