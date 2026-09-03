// Shared, dependency-free types for the extraction pipeline so the pure
// payload builder (index.ts) never has to import the server-only
// provider.ts to reference them.

export type ExtractionProviderName = "anthropic" | "openai" | "mock";

export type ExtractionCallResult = {
  rawText: string;
  provider: ExtractionProviderName;
  model: string;
  requestId: string | null;
  durationMs: number;
  usage: Record<string, number> | null;
};
