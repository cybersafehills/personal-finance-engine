import assert from "node:assert/strict";
import test from "node:test";
import { friendlyError } from "./errors.ts";

test("known database codes become actionable messages", () => {
  assert.match(friendlyError("ERROR: self_approval_forbidden"), /different owner/);
  assert.match(friendlyError("note_required"), /note is required/);
});
test("check violations and unknown errors never leak raw text", () => {
  assert.match(friendlyError('new row violates check constraint "x"'), /not valid/);
  const generic = friendlyError("relation \"secret_table\" does not exist");
  assert.ok(!generic.includes("secret_table"));
});
