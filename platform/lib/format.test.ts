import assert from "node:assert/strict";
import test from "node:test";
import { describeDelta, percentChange, timeAgo } from "./format.ts";

test("percentChange is undefined (null) against a zero baseline", () => {
  assert.equal(percentChange(5, 0), null);
  assert.equal(percentChange(50, 100), -50);
});

test("describeDelta never fabricates a percentage from zero", () => {
  assert.deepEqual(describeDelta(0, 0), { text: "No change", direction: "flat" });
  assert.equal(describeDelta(7, 0).direction, "none");
  assert.deepEqual(describeDelta(150, 100), { text: "+50%", direction: "up" });
  assert.deepEqual(describeDelta(75, 100), { text: "−25%", direction: "down" });
  assert.equal(describeDelta(100, 100).direction, "flat");
});

test("timeAgo buckets", () => {
  const now = new Date("2026-11-19T12:00:00Z");
  assert.equal(timeAgo("2026-11-19T11:59:40Z", now), "just now");
  assert.equal(timeAgo("2026-11-19T11:30:00Z", now), "30 min ago");
  assert.equal(timeAgo("2026-11-19T07:00:00Z", now), "5 h ago");
  assert.equal(timeAgo("not a date", now), "—");
});

import { humanizeAction } from "./format.ts";
test("humanizeAction tidies machine names", () => {
  assert.equal(humanizeAction("staff_directory.viewed"), "Staff directory viewed");
  assert.equal(humanizeAction("permission.denied"), "Permission denied");
  assert.equal(humanizeAction(""), "—");
});
