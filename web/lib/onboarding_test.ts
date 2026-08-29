import { assertEquals } from "jsr:@std/assert@1";
import { deriveOnboardingState, type OnboardingInput } from "./onboarding.ts";

const NOTHING: OnboardingInput = {
  emailConfirmed: false,
  accountCount: 0,
  activeConnectionCount: 0,
  liveConnectionCount: 0,
};

Deno.test("deriveOnboardingState: a brand-new user has 4 steps, none done", () => {
  const s = deriveOnboardingState(NOTHING);
  assertEquals(s.totalCount, 4);
  assertEquals(s.doneCount, 0);
  assertEquals(s.complete, false);
  assertEquals(s.nextStep?.key, "email_confirmed");
});

Deno.test("deriveOnboardingState: email confirmed advances the pointer", () => {
  const s = deriveOnboardingState({ ...NOTHING, emailConfirmed: true });
  assertEquals(s.doneCount, 1);
  assertEquals(s.nextStep?.key, "account_added");
});

Deno.test("deriveOnboardingState: account + active connection, not yet live", () => {
  const s = deriveOnboardingState({
    emailConfirmed: true,
    accountCount: 1,
    activeConnectionCount: 2,
    liveConnectionCount: 0,
  });
  assertEquals(s.doneCount, 3);
  assertEquals(s.nextStep?.key, "connection_live");
  assertEquals(s.complete, false);
});

Deno.test("deriveOnboardingState: complete when a connection has received a message", () => {
  const s = deriveOnboardingState({
    emailConfirmed: true,
    accountCount: 1,
    activeConnectionCount: 1,
    liveConnectionCount: 1,
  });
  assertEquals(s.doneCount, 4);
  assertEquals(s.complete, true);
  assertEquals(s.nextStep, null);
});

Deno.test("deriveOnboardingState: steps are stable in order and shape", () => {
  const s = deriveOnboardingState(NOTHING);
  assertEquals(s.steps.map((x) => x.key), [
    "email_confirmed",
    "account_added",
    "connection_created",
    "connection_live",
  ]);
  for (const step of s.steps) {
    assertEquals(step.title.length > 0, true);
    assertEquals(step.description.length > 0, true);
    assertEquals(step.href.startsWith("/"), true);
    assertEquals(step.cta.length > 0, true);
  }
});

Deno.test("deriveOnboardingState: a later step done while an earlier one isn't still counts", () => {
  // Signals are independent - we don't fabricate a dependency the data
  // doesn't have. (In practice a live connection implies an account, but
  // the derive shouldn't assume it.)
  const s = deriveOnboardingState({ ...NOTHING, liveConnectionCount: 1 });
  assertEquals(s.doneCount, 1);
  assertEquals(s.nextStep?.key, "email_confirmed");
});
