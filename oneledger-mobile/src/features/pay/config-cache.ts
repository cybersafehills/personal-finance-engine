import type { PayConfig } from "./types";

// The last Pay config the tab shell read from GET /api/mobile/config. The centre
// Pay button only exists once that read has succeeded, so by the time the sheet
// opens the answer is already here and the sheet can draw instantly instead of
// waiting on a request (a blank white sheet for a moment was the symptom).

let cached: Partial<PayConfig> | null = null;

export function setPayConfigCache(config: Partial<PayConfig> | null): void {
  cached = config;
}

export function getPayConfigCache(): Partial<PayConfig> | null {
  return cached;
}
