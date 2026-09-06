// Privacy-conscious product-event tracking for the first-run / onboarding
// funnel (master prompt "Analytics events", section 54-55). Mirrors
// lib/spaces/analytics.ts: this codebase has NO analytics provider wired
// in, so this module is the single place a sink would attach, and it
// hard-strips anything that looks like personal or financial data BEFORE
// it could leave the process - the redaction is unit-testable whether or
// not a sink is connected.
//
// Every event is a coarse enum + coarse props: milestone keys, the
// intent enum, small counts, booleans. NEVER a user/workspace id, a
// name, an email, an account identifier, an amount, or a counterparty.
//
// See docs/onboarding-analytics.md for the catalogue and which events
// are wired today vs. available for a stateful caller.

import type { OnboardingJourney } from "../onboarding-milestones.ts";
import { ONBOARDING_MILESTONES } from "../onboarding-milestones.ts";

export type OnboardingEventName =
  // Auth -> product-setup handoff.
  | "onboarding_started" // profile onboarding finished; product setup begins
  | "profile_completed"
  | "preferences_completed"
  // The milestone journey (ADR 0012).
  | "intent_selected"
  | "onboarding_step_completed" // a milestone flipped done (prop: step)
  | "onboarding_completed" // every milestone met
  | "first_review_completed"
  | "first_insight_seen"
  // Setup review screen (section 19).
  | "setup_review_viewed"
  // Leaving the funnel.
  | "onboarding_dismissed";

export const ONBOARDING_EVENT_NAMES: readonly OnboardingEventName[] = [
  "onboarding_started",
  "profile_completed",
  "preferences_completed",
  "intent_selected",
  "onboarding_step_completed",
  "onboarding_completed",
  "first_review_completed",
  "first_insight_seen",
  "setup_review_viewed",
  "onboarding_dismissed",
] as const;

// Keys that must never reach analytics, and value shapes that look like
// raw identifiers (a uuid, a 6+ digit run, an email, a URL). Same guard
// as lib/spaces/analytics.ts.
const FORBIDDEN_KEY =
  /id$|_id|uuid|token|name|email|phone|msisdn|account|amount|balance|counterparty|reference|note/i;
const LOOKS_LIKE_IDENTIFIER =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|(\d[\s-]?){6,}|@|https?:\/\//i;

// The only string prop values we ever allow through: the intent enum and
// the milestone keys. Anything else that is a string gets dropped unless
// it is short and identifier-free (matches the Spaces sanitizer).
const ALLOWED_ENUMS = new Set<string>([
  "personal",
  "household",
  "business",
  ...ONBOARDING_MILESTONES,
]);

export function sanitizeOnboardingEventProps(
  props: Record<string, unknown> | undefined,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!props) return out;
  for (const [key, value] of Object.entries(props)) {
    if (FORBIDDEN_KEY.test(key)) continue;
    if (typeof value === "boolean") {
      out[key] = value;
      continue;
    }
    if (typeof value === "number") {
      if (Number.isFinite(value)) out[key] = Math.min(Math.round(value), 100000);
      continue;
    }
    if (typeof value === "string") {
      if (ALLOWED_ENUMS.has(value)) {
        out[key] = value;
        continue;
      }
      if (LOOKS_LIKE_IDENTIFIER.test(value) || value.length > 32) continue;
      out[key] = value;
    }
  }
  return out;
}

export function trackOnboardingEvent(
  name: OnboardingEventName,
  props?: Record<string, unknown>,
): void {
  const safe = sanitizeOnboardingEventProps(props);
  // No provider connected. When one is added, forward `{ name, ...safe }`
  // here - never the raw `props`. A tracking failure must never break the
  // user action that triggered it.
  try {
    if (process.env.NODE_ENV !== "production") {
      console.debug("[onboarding-event]", name, safe);
    }
  } catch {
    // ignore
  }
}

/**
 * The ordered events implied by a `prev -> next` journey transition: one
 * `onboarding_step_completed` per milestone that flipped done, then
 * `onboarding_completed` if the journey just became complete. Pure - a
 * caller that holds the previous journey (a stateful sink, a cron
 * reconciler) can feed the result straight to `trackOnboardingEvent`.
 * The per-action wiring covers the transitions we can observe
 * synchronously; this covers the derived ones (source added, device
 * paired, connection verified, first real transaction).
 */
export function journeyCompletionEvents(
  prev: OnboardingJourney | null,
  next: OnboardingJourney,
): { name: OnboardingEventName; props?: Record<string, unknown> }[] {
  const wasDone = new Set(
    (prev?.steps ?? []).filter((s) => s.done).map((s) => s.key),
  );
  const events: { name: OnboardingEventName; props?: Record<string, unknown> }[] =
    [];
  for (const step of next.steps) {
    if (step.done && !wasDone.has(step.key)) {
      events.push({ name: "onboarding_step_completed", props: { step: step.key } });
    }
  }
  if (next.complete && !(prev?.complete ?? false)) {
    events.push({ name: "onboarding_completed" });
  }
  return events;
}
