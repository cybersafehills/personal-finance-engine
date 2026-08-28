import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import {
  EXTRACTION_SYSTEM_PROMPT,
  buildExtractionUserPrompt,
} from "./prompt";
import type {
  ExtractionCallResult,
  ExtractionProviderName,
} from "./types";

// The one network boundary for document classification + extraction
// (master prompt §17). Provider is pluggable via AI_PROVIDER
// ("anthropic" default, "openai", or "mock"), mirroring
// lib/ai/report-commentary.ts. EVERY failure mode - no key, provider
// down, timeout, an unsupported input for the chosen provider - returns
// null. The caller treats null exactly like "extraction unavailable" and
// moves the document to processing_failed with a safe retry; the
// original is never touched.

const REQUEST_TIMEOUT_MS = 60_000;
const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
const MAX_OUTPUT_TOKENS = 4096;

export type { ExtractionCallResult, ExtractionProviderName } from "./types";

export function resolveExtractionProvider(): ExtractionProviderName {
  const p = process.env.AI_PROVIDER?.toLowerCase();
  if (p === "openai") return "openai";
  if (p === "mock") return "mock";
  return "anthropic";
}

function base64(bytes: Uint8Array): string {
  // Node Buffer is available in the server runtime; chunk to avoid a
  // huge spread on very large files.
  return Buffer.from(bytes).toString("base64");
}

export async function classifyAndExtract(input: {
  bytes: Uint8Array;
  mimeType: string;
}): Promise<ExtractionCallResult | null> {
  const provider = resolveExtractionProvider();
  const model =
    provider === "anthropic"
      ? process.env.AI_MODEL || DEFAULT_ANTHROPIC_MODEL
      : provider === "openai"
        ? process.env.AI_MODEL || DEFAULT_OPENAI_MODEL
        : "mock";

  const started = Date.now();
  try {
    if (provider === "mock") {
      return {
        rawText: MOCK_RESPONSE,
        provider,
        model,
        requestId: "mock",
        durationMs: Date.now() - started,
        usage: null,
      };
    }
    if (provider === "anthropic") {
      const text = await callAnthropic(input, model);
      if (text == null) return null;
      return {
        rawText: text.rawText,
        provider,
        model,
        requestId: text.requestId,
        durationMs: Date.now() - started,
        usage: text.usage,
      };
    }
    // openai
    const text = await callOpenAi(input, model);
    if (text == null) return null;
    return {
      rawText: text.rawText,
      provider,
      model,
      requestId: text.requestId,
      durationMs: Date.now() - started,
      usage: text.usage,
    };
  } catch (err) {
    console.error(
      "[bill-extract] provider call failed:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

async function callAnthropic(
  input: { bytes: Uint8Array; mimeType: string },
  model: string,
): Promise<{ rawText: string; requestId: string | null; usage: Record<string, number> | null } | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const client = new Anthropic({ apiKey });

  const block =
    input.mimeType === "application/pdf"
      ? {
          type: "document" as const,
          source: {
            type: "base64" as const,
            media_type: "application/pdf" as const,
            data: base64(input.bytes),
          },
        }
      : {
          type: "image" as const,
          source: {
            type: "base64" as const,
            media_type: input.mimeType as "image/jpeg" | "image/png",
            data: base64(input.bytes),
          },
        };

  const response = await client.messages.create(
    {
      model,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: EXTRACTION_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [block, { type: "text", text: buildExtractionUserPrompt() }],
        },
      ],
    },
    { timeout: REQUEST_TIMEOUT_MS },
  );

  const textBlock = response.content.find((b) => b.type === "text");
  const rawText = textBlock?.type === "text" ? textBlock.text : null;
  if (!rawText) return null;
  return {
    rawText,
    requestId: response.id ?? null,
    usage: response.usage
      ? {
          input_tokens: response.usage.input_tokens,
          output_tokens: response.usage.output_tokens,
        }
      : null,
  };
}

async function callOpenAi(
  input: { bytes: Uint8Array; mimeType: string },
  model: string,
): Promise<{ rawText: string; requestId: string | null; usage: Record<string, number> | null } | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  // The chat.completions image path only accepts images. A PDF via
  // OpenAI needs the Responses/Files API; rather than add that surface
  // now, an OpenAI + PDF combination degrades to null (the document
  // moves to processing_failed and a reviewer can retry after switching
  // AI_PROVIDER). Documented in the design doc.
  if (input.mimeType === "application/pdf") return null;

  const client = new OpenAI({ apiKey, timeout: REQUEST_TIMEOUT_MS });
  const dataUri = `data:${input.mimeType};base64,${base64(input.bytes)}`;
  const response = await client.chat.completions.create({
    model,
    max_tokens: MAX_OUTPUT_TOKENS,
    messages: [
      { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: buildExtractionUserPrompt() },
          { type: "image_url", image_url: { url: dataUri } },
        ],
      },
    ],
  });

  const rawText = response.choices[0]?.message?.content ?? null;
  if (!rawText) return null;
  return {
    rawText,
    requestId: response.id ?? null,
    usage: response.usage
      ? {
          input_tokens: response.usage.prompt_tokens,
          output_tokens: response.usage.completion_tokens,
        }
      : null,
  };
}

// Deterministic response for AI_PROVIDER=mock - used by the e2e suite and
// local development without a key. A plausible one-page supplier invoice.
const MOCK_RESPONSE = JSON.stringify({
  doc_class: "supplier_invoice",
  doc_class_confidence: 0.96,
  fields: {
    supplier_name: { value: "Kigali Office Supplies Ltd", confidence: 0.95, page: 1 },
    supplier_tax_id: { value: "TIN 102938475", confidence: 0.9, page: 1 },
    invoice_number: { value: "INV-2026-0442", confidence: 0.97, page: 1 },
    issue_date: { value: "12/08/2026", confidence: 0.93, page: 1 },
    due_date: { value: "11/09/2026", confidence: 0.88, page: 1 },
    currency: { value: "RWF", confidence: 0.99, page: 1 },
    subtotal: { value: "120,000", confidence: 0.94, page: 1 },
    tax_rate: { value: "18%", confidence: 0.92, page: 1 },
    tax_amount: { value: "21,600", confidence: 0.94, page: 1 },
    total: { value: "141,600", confidence: 0.95, page: 1 },
  },
  line_items: [
    {
      description: "A4 paper, 80gsm (box of 5 reams)",
      quantity: "4",
      unit: "box",
      unit_price: "18,000",
      line_total: "72,000",
      tax_rate: "18",
      page: 1,
      confidence: 0.9,
    },
    {
      description: "Whiteboard markers (pack of 12)",
      quantity: "8",
      unit: "pack",
      unit_price: "6,000",
      line_total: "48,000",
      tax_rate: "18",
      page: 1,
      confidence: 0.9,
    },
  ],
});
