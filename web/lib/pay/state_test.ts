import { assertEquals } from "jsr:@std/assert@1";
import {
  canTransition,
  nextStates,
  statusLabel,
  statusTone,
} from "./state.ts";

Deno.test("nextStates: the user-reachable transitions", () => {
  assertEquals(nextStates("draft").sort(), ["cancelled", "initiated"]);
  assertEquals(
    nextStates("initiated").sort(),
    ["awaiting_verification", "cancelled", "expired", "failed"],
  );
  assertEquals(nextStates("awaiting_verification").sort(), ["cancelled", "expired", "failed"]);
});

Deno.test("canTransition: the state machine forbids skipping to successful", () => {
  assertEquals(canTransition("draft", "successful"), false);
  assertEquals(canTransition("awaiting_verification", "successful"), false);
  assertEquals(canTransition("draft", "initiated"), true);
  assertEquals(canTransition("initiated", "awaiting_verification"), true);
  assertEquals(canTransition("successful", "failed"), false);
});

Deno.test("statusLabel: manual confirmation is labelled distinctly from verification", () => {
  assertEquals(
    statusLabel({ state: "successful", manually_confirmed_at: "2026-08-27T00:00:00Z", verified_at: null }),
    "Manually confirmed",
  );
  assertEquals(
    statusLabel({ state: "successful", verified_at: "2026-08-27T00:00:00Z", manually_confirmed_at: null }),
    "Verified",
  );
  assertEquals(statusLabel({ state: "awaiting_verification" }), "Awaiting verification");
  assertEquals(statusLabel({ state: "initiated" }), "Awaiting verification");
});

Deno.test("statusTone: never 'positive' without provider verification", () => {
  assertEquals(
    statusTone({ state: "successful", manually_confirmed_at: "2026-08-27T00:00:00Z", verified_at: null }),
    "neutral",
  );
  assertEquals(statusTone({ state: "awaiting_verification" }), "neutral");
  assertEquals(statusTone({ state: "draft" }), "neutral");
  assertEquals(
    statusTone({ state: "successful", verified_at: "2026-08-27T00:00:00Z" }),
    "positive",
  );
  assertEquals(statusTone({ state: "failed" }), "attention");
  assertEquals(statusTone({ state: "requires_reconciliation" }), "attention");
});
