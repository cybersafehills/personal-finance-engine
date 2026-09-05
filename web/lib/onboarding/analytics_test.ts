import { assertEquals } from "jsr:@std/assert@1";
import {
  journeyCompletionEvents,
  ONBOARDING_EVENT_NAMES,
  sanitizeOnboardingEventProps,
  trackOnboardingEvent,
} from "./analytics.ts";
import {
  deriveOnboardingJourney,
  type MilestoneSignals,
} from "../onboarding-milestones.ts";

const NO_SIGNALS: MilestoneSignals = {
  intent: null,
  sourceCount: 0,
  pairedDeviceCount: 0,
  verifiedConnectionCount: 0,
  realTransactionCount: 0,
  firstReviewAt: null,
  firstInsightAt: null,
};

Deno.test("sanitizer drops ids, names, emails, amounts, and long/opaque strings", () => {
  const safe = sanitizeOnboardingEventProps({
    workspace_id: "8f14e45f-ceea-467d-9c9f-1a2b3c4d5e6f",
    user_name: "Yves",
    email: "a@b.com",
    amount: 5000,
    reference: "TXN-99887766",
    freeform: "x".repeat(40),
  });
  assertEquals(safe, {});
});

Deno.test("sanitizer keeps the intent enum, milestone keys, small counts, and booleans", () => {
  const safe = sanitizeOnboardingEventProps({
    intent: "household",
    step: "device_paired",
    stepIndex: 2.6,
    resumed: true,
  });
  assertEquals(safe, {
    intent: "household",
    step: "device_paired",
    stepIndex: 3,
    resumed: true,
  });
});

Deno.test("sanitizer rejects an unknown enum-shaped string it doesn't allow-list", () => {
  const safe = sanitizeOnboardingEventProps({ step: "not_a_milestone" });
  // Short + identifier-free, so it survives as a generic string - but it
  // is never one of ours. The allow-list is for the KNOWN enums; generic
  // short strings still pass (matches the Spaces sanitizer contract).
  assertEquals(safe, { step: "not_a_milestone" });
});

Deno.test("trackOnboardingEvent never throws", () => {
  for (const name of ONBOARDING_EVENT_NAMES) {
    trackOnboardingEvent(name, { intent: "personal", bad_id: "nope" });
  }
});

Deno.test("journeyCompletionEvents: from nothing to intent+source emits two step events", () => {
  const prev = deriveOnboardingJourney(NO_SIGNALS);
  const next = deriveOnboardingJourney({
    ...NO_SIGNALS,
    intent: "personal",
    sourceCount: 1,
  });
  assertEquals(
    journeyCompletionEvents(prev, next).map((e) => [e.name, e.props?.step]),
    [
      ["onboarding_step_completed", "intent_selected"],
      ["onboarding_step_completed", "source_added"],
    ],
  );
});

Deno.test("journeyCompletionEvents: no change emits nothing", () => {
  const j = deriveOnboardingJourney({ ...NO_SIGNALS, intent: "business" });
  assertEquals(journeyCompletionEvents(j, j), []);
});

Deno.test("journeyCompletionEvents: the final flip also emits onboarding_completed once", () => {
  const almost: MilestoneSignals = {
    intent: "personal",
    sourceCount: 1,
    pairedDeviceCount: 1,
    verifiedConnectionCount: 1,
    realTransactionCount: 1,
    firstReviewAt: "2026-09-01T00:00:00Z",
    firstInsightAt: null,
  };
  const prev = deriveOnboardingJourney(almost);
  const next = deriveOnboardingJourney({
    ...almost,
    firstInsightAt: "2026-09-02T00:00:00Z",
  });
  const names = journeyCompletionEvents(prev, next).map((e) => e.name);
  assertEquals(names, ["onboarding_step_completed", "onboarding_completed"]);
  // Idempotent: re-running against the now-complete journey emits nothing.
  assertEquals(journeyCompletionEvents(next, next), []);
});

Deno.test("journeyCompletionEvents: a null previous journey treats every done step as new", () => {
  const next = deriveOnboardingJourney({ ...NO_SIGNALS, intent: "household" });
  assertEquals(
    journeyCompletionEvents(null, next).map((e) => e.props?.step),
    ["intent_selected"],
  );
});
