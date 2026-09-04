import "server-only";

import { supabaseServer } from "../supabase-server";

// Per-key fixed-window rate limit for the developer API. Backed by the
// api_rate_take() RPC (migration 20261122000000). Fails OPEN on an infra
// error - a rate-limiter outage must not take the API down.

const DEFAULT_PER_MINUTE = 120;
const WINDOW_SECONDS = 60;

export function rateLimitPerMinute(): number {
  const raw = Number(process.env.API_RATE_LIMIT_PER_MINUTE);
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : DEFAULT_PER_MINUTE;
}

export type RateLimitOutcome = {
  allowed: boolean;
  headers: Record<string, string>;
};

export async function takeRateLimit(keyId: string): Promise<RateLimitOutcome> {
  const limit = rateLimitPerMinute();
  const admin = supabaseServer();
  const { data, error } = await admin.rpc("api_rate_take", {
    p_key_id: keyId,
    p_limit: limit,
    p_window_seconds: WINDOW_SECONDS,
  });
  if (error || !data) {
    console.error("takeRateLimit: rpc failed", error?.message);
    return { allowed: true, headers: {} };
  }
  const r = data as {
    allowed: boolean;
    limit: number;
    remaining: number;
    reset_at: string;
  };
  const headers: Record<string, string> = {
    "RateLimit-Limit": String(r.limit),
    "RateLimit-Remaining": String(r.remaining),
    "RateLimit-Reset": r.reset_at,
  };
  if (!r.allowed) headers["Retry-After"] = String(WINDOW_SECONDS);
  return { allowed: r.allowed, headers };
}
