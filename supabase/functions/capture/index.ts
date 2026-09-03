// OneLedger capture endpoint - device pairing v2.
//
// Dark unless the exact-match Edge Function secret DEVICE_PAIRING_V2=enabled is
// set. When dark it 404s so the endpoint looks absent. It never touches the
// live x-ingest-key path in ingest-momo.
//
// Stable address: set ONELEDGER_CAPTURE_BASE_URL (e.g. https://api.oneledger.me/v1)
// once the subdomain is provisioned; until then the function reports its own
// Supabase Functions URL in `capture_url`.

import { createClient } from "npm:@supabase/supabase-js@2";
import { createRateLimiter } from "../_shared/pairing.ts";
import { handlePair, handleTest, type PairingEvent } from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  "";
const PAIRING_V2_ENABLED = Deno.env.get("DEVICE_PAIRING_V2") === "enabled";
const CAPTURE_BASE_URL = (Deno.env.get("ONELEDGER_CAPTURE_BASE_URL") ??
  `${SUPABASE_URL}/functions/v1`).replace(/\/+$/, "");

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function jsonResponse(
  body: Record<string, unknown>,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}

// Coarse per-isolate limiters in front of the DB. Not a distributed quota.
const pairLimiter = createRateLimiter({ windowMs: 60_000, max: 10 });
const testLimiter = createRateLimiter({ windowMs: 60_000, max: 30 });

function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() ||
    "unknown";
}

async function recordEvent(event: PairingEvent): Promise<void> {
  try {
    const { error } = await supabase.from("connector_pairing_events").insert({
      event: event.event,
      reason_code: event.reasonCode ?? null,
      pairing_session_id: event.pairingSessionId ?? null,
      connector_installation_id: event.connectorInstallationId ?? null,
      device_credential_id: event.deviceCredentialId ?? null,
    });
    if (error) {
      console.error(JSON.stringify({
        event: "pairing_event_write_failed",
        kind: event.event,
      }));
    }
  } catch {
    console.error(JSON.stringify({
      event: "pairing_event_write_failed",
      kind: event.event,
    }));
  }
}

Deno.serve(async (req: Request) => {
  if (!PAIRING_V2_ENABLED) {
    return jsonResponse({ ok: false, error: "not_found" }, 404);
  }
  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ ok: false, error: "INVALID_CAPTURE_PAYLOAD" }, 400);
  }

  const op = (body as Record<string, unknown> | null)?.op;

  try {
    if (op === "pair") {
      const rate = pairLimiter.check(`pair:${clientIp(req)}`);
      if (!rate.ok) {
        return jsonResponse({ ok: false, error: "RATE_LIMITED" }, 429, {
          "Retry-After": String(rate.retryAfterSec),
        });
      }
      const result = await handlePair(body, {
        captureUrl: `${CAPTURE_BASE_URL}/capture`,
        recordEvent,
        consumePairingSession: async (args) => {
          const { data, error } = await supabase.rpc(
            "consume_device_pairing_session",
            {
              p_token_hash: args.tokenHash,
              p_new_credential_hash: args.credentialHash,
              p_new_credential_prefix: args.credentialPrefix,
              p_client_version: args.clientVersion,
              p_platform: args.platform,
              p_device_label: args.deviceLabel,
            },
          ).maybeSingle();

          if (error || !data) {
            return { ok: false, code: error?.message ?? "PAIRING_INVALID" };
          }
          const row = data as {
            device_credential_id: string;
            connector_installation_id: string;
            legacy_ingestion_connection_id: string | null;
          };
          return {
            ok: true,
            deviceCredentialId: row.device_credential_id,
            connectorInstallationId: row.connector_installation_id,
            legacyIngestionConnectionId: row.legacy_ingestion_connection_id,
          };
        },
      });
      return jsonResponse(result.body, result.status, result.headers);
    }

    if (op === "test") {
      const headerKey = req.headers.get("x-device-key");
      const rate = testLimiter.check(
        `test:${(headerKey ?? "").slice(0, 8) || clientIp(req)}`,
      );
      if (!rate.ok) {
        return jsonResponse({ ok: false, error: "RATE_LIMITED" }, 429, {
          "Retry-After": String(rate.retryAfterSec),
        });
      }
      const result = await handleTest(headerKey, body, {
        recordEvent,
        authenticateDevice: async (credentialHash) => {
          const { data, error } = await supabase.rpc(
            "resolve_canonical_ingestion_credential",
            { p_credential_hash: credentialHash },
          ).maybeSingle();
          if (error || !data) {
            return { ok: false, code: "INVALID_DEVICE_CREDENTIAL" };
          }
          const row = data as { device_credential_id: string };
          return { ok: true, deviceCredentialId: row.device_credential_id };
        },
        touchCredential: async (deviceCredentialId) => {
          const { error } = await supabase
            .from("device_credentials")
            .update({ last_used_at: new Date().toISOString() })
            .eq("id", deviceCredentialId);
          if (error) {
            console.error(JSON.stringify({ event: "device_touch_failed" }));
          }
        },
      }, new Date());
      return jsonResponse(result.body, result.status, result.headers);
    }
  } catch (err) {
    console.error(JSON.stringify({
      event: "capture_unhandled_error",
      op: typeof op === "string" ? op : null,
      message: err instanceof Error ? err.message.slice(0, 120) : "unknown",
    }));
    return jsonResponse({ ok: false, error: "internal_error" }, 500);
  }

  return jsonResponse({ ok: false, error: "unsupported_op" }, 400);
});
