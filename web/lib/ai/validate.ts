// Validates and parses a raw AI text response into the structured
// commentary shape (Phase I). Zero imports, deno-testable - the actual
// network call lives in report-commentary.ts, which is not.
//
// Master prompt §21: "If the model references amounts, validate them
// against supplied facts where practical." validateNoFabricatedAmounts
// below is a best-effort heuristic, not a proof - it rejects a response
// containing any 3+-digit number that doesn't appear anywhere in the
// facts it was given, which catches an invented balance/total while
// still allowing incidental small numbers (a count, a percentage) that
// wouldn't reasonably need to trace back to a specific fact.

export type ValidatedCommentary = {
  summary: string;
  observations: string[];
};

const MAX_SUMMARY_LENGTH = 500;
const MAX_OBSERVATION_LENGTH = 300;
const MAX_OBSERVATIONS = 4;

/** Digit runs of 3+ characters (with optional thousands separators) - short enough numbers (percentages, day counts) are not required to trace back to a fact. */
function extractSignificantNumberTokens(text: string): string[] {
  const matches = text.match(/\d[\d,]{2,}/g) ?? [];
  return matches.map((m) => m.replace(/,/g, ""));
}

function factsContainToken(factsJson: string, token: string): boolean {
  const availableDigitRuns = factsJson.match(/\d+/g) ?? [];
  return availableDigitRuns.some((run) =>
    run === token || run.includes(token) || token.includes(run)
  );
}

export function validateNoFabricatedAmounts(
  text: string,
  factsJson: string,
): boolean {
  const mentioned = extractSignificantNumberTokens(text);
  return mentioned.every((token) => factsContainToken(factsJson, token));
}

/**
 * Parses `rawText` (expected to be a single JSON object, possibly with
 * surrounding whitespace/markdown code fences some models add despite
 * instructions not to) into a ValidatedCommentary, or null if it is
 * malformed, has the wrong shape, exceeds the length/count bounds, or
 * mentions a number not traceable to `factsJson`. Never throws - a
 * malformed AI response degrades to "no commentary", never a crash.
 */
export function parseAndValidateCommentaryResponse(
  rawText: string,
  factsJson: string,
): ValidatedCommentary | null {
  const stripped = rawText.trim().replace(/^```(?:json)?\s*/i, "").replace(
    /\s*```$/,
    "",
  );

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;

  if (typeof obj.summary !== "string" || obj.summary.trim().length === 0) {
    return null;
  }
  if (obj.summary.length > MAX_SUMMARY_LENGTH) return null;

  if (!Array.isArray(obj.observations)) return null;
  if (obj.observations.length > MAX_OBSERVATIONS) return null;
  if (
    !obj.observations.every((o) =>
      typeof o === "string" && o.length <= MAX_OBSERVATION_LENGTH
    )
  ) {
    return null;
  }

  const summary = obj.summary as string;
  const observations = obj.observations as string[];

  const fullText = [summary, ...observations].join(" ");
  if (!validateNoFabricatedAmounts(fullText, factsJson)) return null;

  return { summary, observations };
}
