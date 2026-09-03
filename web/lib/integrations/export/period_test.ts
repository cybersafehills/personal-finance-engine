import { assertEquals } from "jsr:@std/assert@1";
import { resolvePeriod } from "./period.ts";

const NOW = new Date("2026-09-15T12:00:00.000Z"); // a Tuesday

Deno.test("absolute period passes through", () => {
  assertEquals(
    resolvePeriod(
      { kind: "absolute", from: "2026-01-01T00:00:00Z", to: "2026-03-31T23:59:59Z" },
      NOW,
    ),
    { from: "2026-01-01T00:00:00Z", to: "2026-03-31T23:59:59Z", label: "Custom range" },
  );
});

Deno.test("previous_month is the whole prior calendar month", () => {
  const p = resolvePeriod({ kind: "relative", preset: "previous_month" }, NOW);
  assertEquals(p.from, "2026-08-01T00:00:00.000Z");
  assertEquals(p.to, "2026-08-31T23:59:59.000Z");
});

Deno.test("previous_month wraps the year at January", () => {
  const p = resolvePeriod(
    { kind: "relative", preset: "previous_month" },
    new Date("2026-01-10T00:00:00Z"),
  );
  assertEquals(p.from, "2025-12-01T00:00:00.000Z");
  assertEquals(p.to, "2025-12-31T23:59:59.000Z");
});

Deno.test("current_month starts on the 1st", () => {
  const p = resolvePeriod({ kind: "relative", preset: "current_month" }, NOW);
  assertEquals(p.from, "2026-09-01T00:00:00.000Z");
  assertEquals(p.to, NOW.toISOString());
});

Deno.test("previous_week is the Monday..Sunday before this one", () => {
  const p = resolvePeriod({ kind: "relative", preset: "previous_week" }, NOW);
  // week containing 2026-09-15 starts Mon 2026-09-14; previous week 09-07..09-13
  assertEquals(p.from, "2026-09-07T00:00:00.000Z");
  assertEquals(p.to, "2026-09-13T23:59:59.000Z");
});

Deno.test("all time starts at the epoch", () => {
  const p = resolvePeriod({ kind: "relative", preset: "all" }, NOW);
  assertEquals(p.from, "1970-01-01T00:00:00.000Z");
});
