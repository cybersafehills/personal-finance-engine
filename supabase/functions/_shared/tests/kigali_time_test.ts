import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { kigaliDateKey, kigaliDayBoundsUtc } from "../kigali-time.ts";

Deno.test("O. instant just before the Kigali midnight boundary stays on the earlier day", () => {
  assertEquals(kigaliDateKey("2026-08-18T21:59:59.999Z"), "2026-08-18");
});

Deno.test("O. instant exactly at the Kigali midnight boundary rolls to the next day", () => {
  assertEquals(kigaliDateKey("2026-08-18T22:00:00.000Z"), "2026-08-19");
});

Deno.test("an instant written directly in +02:00 form at local midnight resolves to that same local day", () => {
  assertEquals(kigaliDateKey("2026-08-19T00:00:00+02:00"), "2026-08-19");
  assertEquals(kigaliDateKey("2026-08-18T23:59:59.999+02:00"), "2026-08-18");
});

Deno.test("kigaliDateKey is independent of the offset the instant was written with", () => {
  // 2026-08-18T10:20:09+02:00 and its UTC equivalent must resolve to the
  // same Kigali calendar date.
  assertEquals(
    kigaliDateKey("2026-08-18T10:20:09+02:00"),
    kigaliDateKey("2026-08-18T08:20:09Z"),
  );
});

Deno.test("kigaliDateKey rejects an invalid instant", () => {
  assertThrows(() => kigaliDateKey("not-a-date"), RangeError);
});

Deno.test("kigaliDayBoundsUtc returns the correct UTC window for a Kigali calendar day", () => {
  const { startUtc, endUtc } = kigaliDayBoundsUtc("2026-08-18");

  assertEquals(startUtc.toISOString(), "2026-08-17T22:00:00.000Z");
  assertEquals(endUtc.toISOString(), "2026-08-18T21:59:59.999Z");
});

Deno.test("kigaliDayBoundsUtc round-trips through kigaliDateKey at both edges", () => {
  const { startUtc, endUtc } = kigaliDayBoundsUtc("2026-08-18");

  assertEquals(kigaliDateKey(startUtc.toISOString()), "2026-08-18");
  assertEquals(kigaliDateKey(endUtc.toISOString()), "2026-08-18");

  const oneMillisecondAfterEnd = new Date(endUtc.getTime() + 1);
  assertEquals(
    kigaliDateKey(oneMillisecondAfterEnd.toISOString()),
    "2026-08-19",
  );
});

Deno.test("kigaliDayBoundsUtc rejects a malformed date key", () => {
  assertThrows(() => kigaliDayBoundsUtc("2026/08/18"), RangeError);
});
