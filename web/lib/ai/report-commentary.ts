import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { formatDateKeyLabel } from "../format";
import { buildCommentaryPrompt, buildSanitizedReportFacts } from "./facts";
import { parseAndValidateCommentaryResponse } from "./validate";
import type { AiCommentaryPayload, ReportPayload } from "../report-types";

// Optional AI enrichment (Phase I) - the ONLY function reporting code
// calls. Every failure mode (no key configured, provider down, timeout,
// invalid response) returns null, never throws - the deterministic
// report must never depend on this succeeding (master prompt §21/§37).
//
// Provider is pluggable and picked at call time via AI_PROVIDER
// ("anthropic", the default, or "openai"), so switching providers is a
// config change, not a code change - both SDKs are already dependencies.
// Neither client is constructed (nor its SDK's env var read eagerly) at
// module load, matching lib/resend.ts's lazy-construction pattern, so a
// missing key degrades to "no client" rather than a startup crash.

const REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";

type AiProviderName = "anthropic" | "openai";

function resolveProviderName(): AiProviderName {
  const configured = process.env.AI_PROVIDER?.toLowerCase();
  return configured === "openai" ? "openai" : "anthropic";
}

async function callAnthropic(system: string, user: string, model: string): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const client = new Anthropic({ apiKey });
  const response = await client.messages.create(
    {
      model,
      max_tokens: 512,
      system,
      messages: [{ role: "user", content: user }],
    },
    { timeout: REQUEST_TIMEOUT_MS },
  );

  const textBlock = response.content.find((block) => block.type === "text");
  return textBlock?.type === "text" ? textBlock.text : null;
}

async function callOpenAi(system: string, user: string, model: string): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const client = new OpenAI({ apiKey, timeout: REQUEST_TIMEOUT_MS });
  const response = await client.chat.completions.create({
    model,
    max_tokens: 512,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });

  return response.choices[0]?.message?.content ?? null;
}

/**
 * Generates report commentary for one already-generated report, or
 * returns null if AI enrichment is unavailable/disabled/fails/returns an
 * invalid response for any reason. Callers (report-generation.ts) treat
 * null exactly like "no AI configured" - there is no separate error path
 * to handle, by design.
 */
export async function generateReportCommentary(
  payload: ReportPayload,
  alertSummaries: string[],
): Promise<AiCommentaryPayload | null> {
  const provider = resolveProviderName();
  const model = provider === "anthropic"
    ? (process.env.AI_MODEL || DEFAULT_ANTHROPIC_MODEL)
    : (process.env.AI_MODEL || DEFAULT_OPENAI_MODEL);

  const facts = buildSanitizedReportFacts(payload, formatDateKeyLabel(payload.dateKey), alertSummaries);
  const { system, user } = buildCommentaryPrompt(facts);
  const factsJson = JSON.stringify(facts);

  try {
    const rawText = provider === "anthropic"
      ? await callAnthropic(system, user, model)
      : await callOpenAi(system, user, model);

    if (!rawText) return null;

    const validated = parseAndValidateCommentaryResponse(rawText, factsJson);
    if (!validated) {
      console.error(`AI commentary: ${provider} response failed validation, discarding`);
      return null;
    }

    return {
      summary: validated.summary,
      observations: validated.observations,
      provider,
      model,
      generatedAt: new Date().toISOString(),
    };
  } catch (err) {
    console.error(`AI commentary: ${provider} request failed:`, err instanceof Error ? err.message : err);
    return null;
  }
}
