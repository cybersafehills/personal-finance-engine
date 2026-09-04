// Pure, dependency-injected request handling for the capture Edge Function.
// index.ts wires these to the real Supabase service-role client; the tests
// wire fakes - no live database or HTTP server needed.
//
// Operations:
//   op:"pair"    - exchange a one-time pairing token + a device-generated
//                  secret for a scoped device credential. Never echoes it.
//   op:"test"    - prove a device credential authenticates and the endpoint
//                  is reachable. Writes NO ledger data.
//   op:"capture" - a real inbound transaction message. Authenticates,
//                  validates, detects the provider, and writes ONE canonical
//                  raw_financial_events evidence row (parse_status='pending').
//                  It never creates a `transactions` row - a separate
//                  processor normalizes pending capture rows (ADR 0009).

import {
  type CaptureEnvelope,
  DEVICE_SECRET_PATTERN,
  DEVICE_SECRET_PREFIX_PATTERN,
  extractPairingErrorCode,
  mapPairingReasonToHttp,
  PAIRING_TOKEN_PATTERN,
  sha256Hex,
  validateCaptureEnvelope,
} from "../_shared/pairing.ts";
import { detectProvider } from "../_shared/providers.ts";
import { normalizeMessage } from "../ingest-momo/parser-utils.ts";

export type HandlerResult = {
  status: number;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
};

export type PairingEvent = {
  event:
    | "device_paired"
    | "device_pairing_failed"
    | "device_test_succeeded"
    | "device_test_failed"
    | "capture_accepted"
    | "capture_rejected";
  reasonCode?: string | null;
  pairingSessionId?: string | null;
  connectorInstallationId?: string | null;
  deviceCredentialId?: string | null;
};

export type ConsumePairingResult =
  | {
    ok: true;
    deviceCredentialId: string;
    connectorInstallationId: string;
    legacyIngestionConnectionId: string | null;
  }
  | { ok: false; code: string };

export type PairDeps = {
  consumePairingSession: (args: {
    tokenHash: string;
    credentialHash: string;
    credentialPrefix: string;
    clientVersion: string;
    platform: string;
    deviceLabel: string | null;
  }) => Promise<ConsumePairingResult>;
  recordEvent: (event: PairingEvent) => Promise<void>;
  captureUrl: string;
};

export type DeviceAuthResult =
  | { ok: true; deviceCredentialId: string }
  | { ok: false; code: "INVALID_DEVICE_CREDENTIAL" };

export type TestDeps = {
  authenticateDevice: (credentialHash: string) => Promise<DeviceAuthResult>;
  touchCredential: (deviceCredentialId: string) => Promise<void>;
  recordEvent: (event: PairingEvent) => Promise<void>;
};

const PLATFORMS = new Set(["ios", "ipados", "android", "macos", "other"]);

function asRecord(input: unknown): Record<string, unknown> | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return null;
  }
  return input as Record<string, unknown>;
}

export async function handlePair(
  input: unknown,
  deps: PairDeps,
): Promise<HandlerResult> {
  const body = asRecord(input);
  if (!body) {
    return { status: 400, body: { ok: false, error: "PAIRING_INVALID" } };
  }

  const pairingToken = body.pairing_token;
  const deviceSecret = body.device_secret;
  const clientVersion = typeof body.client_version === "string"
    ? body.client_version
    : "";
  const platformRaw = typeof body.platform === "string"
    ? body.platform.toLowerCase()
    : "other";
  const platform = PLATFORMS.has(platformRaw) ? platformRaw : "other";
  const deviceLabel = typeof body.device_label === "string" &&
      body.device_label.trim().length > 0
    ? body.device_label.trim().slice(0, 120)
    : null;

  if (
    typeof pairingToken !== "string" ||
    !PAIRING_TOKEN_PATTERN.test(pairingToken)
  ) {
    await deps.recordEvent({
      event: "device_pairing_failed",
      reasonCode: "PAIRING_INVALID",
    });
    return { status: 400, body: { ok: false, error: "PAIRING_INVALID" } };
  }

  if (
    typeof deviceSecret !== "string" ||
    !DEVICE_SECRET_PATTERN.test(deviceSecret)
  ) {
    await deps.recordEvent({
      event: "device_pairing_failed",
      reasonCode: "PAIRING_BAD_CREDENTIAL",
    });
    return {
      status: 400,
      body: { ok: false, error: "PAIRING_BAD_CREDENTIAL" },
    };
  }

  const credentialPrefix = deviceSecret.slice(0, 8);
  if (!DEVICE_SECRET_PREFIX_PATTERN.test(credentialPrefix)) {
    await deps.recordEvent({
      event: "device_pairing_failed",
      reasonCode: "PAIRING_BAD_CREDENTIAL",
    });
    return {
      status: 400,
      body: { ok: false, error: "PAIRING_BAD_CREDENTIAL" },
    };
  }

  if (!/^\d+\.\d+\.\d+$/.test(clientVersion)) {
    await deps.recordEvent({
      event: "device_pairing_failed",
      reasonCode: "PAIRING_INVALID",
    });
    return { status: 400, body: { ok: false, error: "PAIRING_INVALID" } };
  }

  const [tokenHash, credentialHash] = await Promise.all([
    sha256Hex(pairingToken),
    sha256Hex(deviceSecret),
  ]);

  const result = await deps.consumePairingSession({
    tokenHash,
    credentialHash,
    credentialPrefix,
    clientVersion,
    platform,
    deviceLabel,
  });

  if (!result.ok) {
    const code = extractPairingErrorCode(result.code) ?? "PAIRING_INVALID";
    await deps.recordEvent({
      event: "device_pairing_failed",
      reasonCode: code,
    });
    return {
      status: mapPairingReasonToHttp(code),
      body: { ok: false, error: code },
    };
  }

  await deps.recordEvent({
    event: "device_paired",
    deviceCredentialId: result.deviceCredentialId,
    connectorInstallationId: result.connectorInstallationId,
  });

  // The device secret is never returned - the caller already holds it.
  return {
    status: 200,
    body: {
      ok: true,
      device_id: result.deviceCredentialId,
      capture_url: deps.captureUrl,
    },
  };
}

export async function handleTest(
  headerKey: string | null,
  input: unknown,
  deps: TestDeps,
  now: Date,
): Promise<HandlerResult> {
  if (!headerKey || !DEVICE_SECRET_PATTERN.test(headerKey)) {
    return {
      status: 401,
      body: { ok: false, error: "INVALID_DEVICE_CREDENTIAL" },
    };
  }

  const credentialHash = await sha256Hex(headerKey);
  const auth = await deps.authenticateDevice(credentialHash);
  if (!auth.ok) {
    return {
      status: 401,
      body: { ok: false, error: "INVALID_DEVICE_CREDENTIAL" },
    };
  }

  const envelope = validateCaptureEnvelope(input, now, {
    requireMessage: false,
  });
  if (!envelope.ok) {
    await deps.recordEvent({
      event: "capture_rejected",
      reasonCode: envelope.code,
      deviceCredentialId: auth.deviceCredentialId,
    });
    return {
      status: 400,
      body: { ok: false, error: envelope.code },
    };
  }

  // Prove-only: touch last_used_at, record the audit event, write nothing else.
  await deps.touchCredential(auth.deviceCredentialId);
  await deps.recordEvent({
    event: "device_test_succeeded",
    deviceCredentialId: auth.deviceCredentialId,
  });

  return { status: 200, body: { ok: true, test: true } };
}

// ---------------------------------------------------------------------------
// op:"capture"
// ---------------------------------------------------------------------------

/** Trusted routing scope for a captured message - all server-resolved from the credential. */
export type CaptureRoute = {
  deviceCredentialId: string;
  connectorInstallationId: string;
  /** Paired devices always carry a legacy mapping (canonical auth requires it). */
  legacyIngestionConnectionId: string;
  financialSourceId: string | null;
  workspaceId: string;
  accountId: string | null;
};

export type CaptureRecordResult = {
  outcome: "queued" | "duplicate";
  eventId: string | null;
};

export type CaptureDeps = {
  authenticateDevice: (
    credentialHash: string,
  ) => Promise<{ ok: true; route: CaptureRoute } | { ok: false }>;
  /**
   * Writes ONE `raw_financial_events` row (parse_status='pending', canonical
   * provenance, ingestion_origin='iphone_capture_v2'). On a
   * (ingestion_connection_id, payload_hash) conflict it reports "duplicate"
   * and writes nothing new.
   */
  recordRawEvent: (args: {
    route: CaptureRoute;
    payloadHash: string;
    message: string;
    receivedAt: string;
    providerKey: string;
    clientVersion: string;
  }) => Promise<CaptureRecordResult>;
  recordEvent: (event: PairingEvent) => Promise<void>;
  /**
   * Stamps device_credentials.last_used_at - the only signal
   * ConnectionReadinessProbe (web/components) polls to flip the pairing
   * wizard's Verify step from "waiting" to "this connection is live". Called
   * for every well-formed, authenticated capture request, including an
   * unrecognised message (UNKNOWN_PROVIDER) - "is this device successfully
   * talking to us" is true the moment the envelope validates, independent of
   * whether this particular SMS happened to match a known provider format.
   * Previously only op:"test" touched this column, so a real captured
   * transaction never marked the connection ready.
   */
  touchCredential: (deviceCredentialId: string) => Promise<void>;
};

export async function handleCapture(
  headerKey: string | null,
  input: unknown,
  deps: CaptureDeps,
  now: Date,
): Promise<HandlerResult> {
  if (!headerKey || !DEVICE_SECRET_PATTERN.test(headerKey)) {
    return {
      status: 401,
      body: { ok: false, error: "INVALID_DEVICE_CREDENTIAL" },
    };
  }

  const auth = await deps.authenticateDevice(await sha256Hex(headerKey));
  if (!auth.ok) {
    return {
      status: 401,
      body: { ok: false, error: "INVALID_DEVICE_CREDENTIAL" },
    };
  }
  const route = auth.route;

  const envelope = validateCaptureEnvelope(input, now, {
    requireMessage: true,
  });
  if (!envelope.ok) {
    await deps.recordEvent({
      event: "capture_rejected",
      reasonCode: envelope.code,
      deviceCredentialId: route.deviceCredentialId,
      connectorInstallationId: route.connectorInstallationId,
    });
    return { status: 400, body: { ok: false, error: envelope.code } };
  }
  const message = envelope.value.message as string; // requireMessage → non-null

  await deps.touchCredential(route.deviceCredentialId);

  const provider = detectProvider(message);
  if (!provider) {
    await deps.recordEvent({
      event: "capture_rejected",
      reasonCode: "UNKNOWN_PROVIDER",
      deviceCredentialId: route.deviceCredentialId,
      connectorInstallationId: route.connectorInstallationId,
    });
    // Same posture as ingest-momo's not_rwf_message: an unrecognised message
    // is turned away, not stored as evidence.
    return { status: 422, body: { ok: false, error: "UNKNOWN_PROVIDER" } };
  }

  // Same normalized-message digest ingest-momo uses, so a message that arrives
  // through both paths for one connection collapses to a single evidence row.
  const payloadHash = await sha256Hex(normalizeMessage(message));

  const recorded = await deps.recordRawEvent({
    route,
    payloadHash,
    message,
    receivedAt: envelope.value.received_at,
    providerKey: provider.providerKey,
    clientVersion: envelope.value.client_version,
  });

  if (recorded.outcome === "duplicate") {
    return { status: 200, body: { ok: true, status: "duplicate" } };
  }

  await deps.recordEvent({
    event: "capture_accepted",
    deviceCredentialId: route.deviceCredentialId,
    connectorInstallationId: route.connectorInstallationId,
  });
  return {
    status: 202,
    body: { ok: true, status: "queued", event_id: recorded.eventId },
  };
}

export type { CaptureEnvelope };
