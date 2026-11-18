import { assertEquals } from "jsr:@std/assert@1";
import { assessSilence } from "./silence.ts";

const NOW = Date.parse("2026-11-18T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
const every = (gapH: number, n: number, startAgo = 5) =>
  Array.from({ length: n }, (_, k) => hoursAgo(startAgo + k * gapH));

Deno.test("never heard from: not quiet (that is 'waiting', not 'silent')", () => {
  assertEquals(
    assessSilence({ lastSeenIso: null, arrivalsIso: [], nowMs: NOW }).quiet,
    false,
  );
});

Deno.test("too few messages to know a rhythm: the plain 48h minimum applies", () => {
  const r = assessSilence({
    lastSeenIso: hoursAgo(50),
    arrivalsIso: every(10, 3, 50),
    nowMs: NOW,
  });
  assertEquals(r.typicalGapHours, null);
  assertEquals(r.thresholdHours, 48);
  assertEquals(r.quiet, true);
  assertEquals(
    assessSilence({ lastSeenIso: hoursAgo(40), arrivalsIso: [], nowMs: NOW })
      .quiet,
    false,
  );
});

Deno.test("a busy wallet is still held to the 48h floor, never flagged sooner", () => {
  // a message every 2h: 5 x 2 = 10h, floored to 48h.
  const arrivals = every(2, 30, 20);
  const r = assessSilence({
    lastSeenIso: hoursAgo(20),
    arrivalsIso: arrivals,
    nowMs: NOW,
  });
  assertEquals(r.thresholdHours, 48);
  assertEquals(r.quiet, false);
});

Deno.test("a slow wallet gets a longer leash, capped at 10 days", () => {
  // a message every 48h: 5 x 48 = 240h = the cap.
  const slow = every(48, 8, 100);
  const r = assessSilence({
    lastSeenIso: hoursAgo(100),
    arrivalsIso: slow,
    nowMs: NOW,
  });
  assertEquals(r.thresholdHours, 240);
  assertEquals(r.quiet, false);
  // a message every 100h would be 500h: still capped.
  const slower = every(100, 8, 100);
  assertEquals(
    assessSilence({
      lastSeenIso: hoursAgo(260),
      arrivalsIso: slower,
      nowMs: NOW,
    }).thresholdHours,
    240,
  );
});

Deno.test("the newest arrival counts as a sign of life even if last_seen is older", () => {
  const r = assessSilence({
    lastSeenIso: hoursAgo(300),
    arrivalsIso: every(1, 6, 3),
    nowMs: NOW,
  });
  assertEquals(r.quiet, false);
  assertEquals(Math.round(r.silentHours!), 3);
});

Deno.test("Equity-style case: normally every ~6h, silent for 3 days is flagged", () => {
  const arrivals = every(6, 20, 72);
  const r = assessSilence({
    lastSeenIso: hoursAgo(72),
    arrivalsIso: arrivals,
    nowMs: NOW,
  });
  assertEquals(r.thresholdHours, 48);
  assertEquals(r.quiet, true);
});
