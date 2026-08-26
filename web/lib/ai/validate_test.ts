import { assertEquals } from "jsr:@std/assert@1";
import {
  parseAndValidateCommentaryResponse,
  validateNoFabricatedAmounts,
} from "./validate.ts";

const FACTS_JSON = JSON.stringify({
  closingBalanceRwf: 117_250,
  moneySpentRwf: 12_500,
  netMovementRwf: 17_250,
  transactionCount: 3,
});

Deno.test("parseAndValidateCommentaryResponse: accepts a well-formed response", () => {
  const raw = JSON.stringify({
    summary: "You received more than you spent today.",
    observations: ["Your net movement was positive at 17,250 RWF."],
  });
  const result = parseAndValidateCommentaryResponse(raw, FACTS_JSON);
  assertEquals(result?.summary, "You received more than you spent today.");
  assertEquals(result?.observations.length, 1);
});

Deno.test("parseAndValidateCommentaryResponse: strips a markdown code fence some models add despite instructions", () => {
  const raw = "```json\n" +
    JSON.stringify({ summary: "All good.", observations: [] }) + "\n```";
  const result = parseAndValidateCommentaryResponse(raw, FACTS_JSON);
  assertEquals(result?.summary, "All good.");
});

Deno.test("parseAndValidateCommentaryResponse: rejects invalid JSON, never throws", () => {
  const result = parseAndValidateCommentaryResponse(
    "not json at all {{{",
    FACTS_JSON,
  );
  assertEquals(result, null);
});

Deno.test("parseAndValidateCommentaryResponse: rejects a missing summary field", () => {
  const raw = JSON.stringify({ observations: ["something"] });
  assertEquals(parseAndValidateCommentaryResponse(raw, FACTS_JSON), null);
});

Deno.test("parseAndValidateCommentaryResponse: rejects a non-array observations field", () => {
  const raw = JSON.stringify({ summary: "ok", observations: "not an array" });
  assertEquals(parseAndValidateCommentaryResponse(raw, FACTS_JSON), null);
});

Deno.test("parseAndValidateCommentaryResponse: rejects more than the maximum number of observations", () => {
  const raw = JSON.stringify({
    summary: "ok",
    observations: ["a", "b", "c", "d", "e"],
  });
  assertEquals(parseAndValidateCommentaryResponse(raw, FACTS_JSON), null);
});

Deno.test("parseAndValidateCommentaryResponse: rejects an oversized summary", () => {
  const raw = JSON.stringify({ summary: "x".repeat(501), observations: [] });
  assertEquals(parseAndValidateCommentaryResponse(raw, FACTS_JSON), null);
});

Deno.test("parseAndValidateCommentaryResponse: rejects a fabricated amount not present in the supplied facts", () => {
  const raw = JSON.stringify({
    summary: "You have 999999999 RWF saved up, congratulations!",
    observations: [],
  });
  assertEquals(parseAndValidateCommentaryResponse(raw, FACTS_JSON), null);
});

Deno.test("validateNoFabricatedAmounts: small incidental numbers (percentages, counts) are not required to trace back to a fact", () => {
  assertEquals(
    validateNoFabricatedAmounts(
      "You made 3 transactions today, up 12% from average.",
      FACTS_JSON,
    ),
    true,
  );
});

Deno.test("validateNoFabricatedAmounts: a large number matching a supplied fact is accepted", () => {
  assertEquals(
    validateNoFabricatedAmounts(
      "Your closing balance is 117250 RWF.",
      FACTS_JSON,
    ),
    true,
  );
});

Deno.test("validateNoFabricatedAmounts: a large number with no relation to any supplied fact is rejected", () => {
  assertEquals(
    validateNoFabricatedAmounts(
      "You saved 5000000 RWF this month!",
      FACTS_JSON,
    ),
    false,
  );
});
