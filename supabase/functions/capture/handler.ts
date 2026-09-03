// Pure, dependency-injected request handling for the capture Edge Function.
// index.ts wires these to the real Supabase service-role client; the tests
// wire fakes - no live database or HTTP server needed.
//
// Two operations in PR1:
//   op:"pair" - exchange a one-time pairing token + a device-generated secret
//               for a scoped device credential. Never echoes the secret.
//   op:"test" - prove an existing device credential authenticates and the
//               endpoint is reachable. Writes NO ledger data.
//
// The real inbound-message path (op:"capture") is a follow-up PR; this file
// deliberately has no transaction/raw-event writes.

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

export type { CaptureEnvelope };
