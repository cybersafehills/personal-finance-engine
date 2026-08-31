import {
  buildConnectorDiscoveryPayload,
  type ConnectorAdapter,
  type ConnectorDiscoveryPayload,
  type ConnectorEventEnvelope,
  type ConnectorInstallationContext,
  hashConnectorReference,
} from "../_shared/connector-adapter.ts";
import { parseMomoMessage } from "./parser.ts";
import type { ParsedTransaction } from "./types.ts";

export const MTN_MOMO_SMS_CONNECTOR_KEY = "mtn_momo_sms_v1";
export const MTN_MOMO_SMS_ADAPTER_VERSION = "1";

export type MtnMomoSmsConfiguration = {
  msisdn: string;
  sourceDisplayName: string;
  accountDisplayName: string;
  maskedIdentifier: string;
};

export type MtnMomoSmsRawEvent = {
  message: string;
  receivedAt: string | null;
  sourceExternalRef: string | null;
  accountExternalRef: string | null;
  providerEventReference: string;
};

const CONFIGURATION_KEYS = new Set([
  "msisdn",
  "sourceDisplayName",
  "accountDisplayName",
  "maskedIdentifier",
]);

function object(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(code);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: Set<string>,
  code: string,
): void {
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new Error(code);
  }
}

function text(value: unknown, code: string, maxLength: number): string {
  if (typeof value !== "string") throw new Error(code);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) throw new Error(code);
  return normalized;
}

function normalizeRwandaMsisdn(value: unknown): string {
  const digits = text(value, "mtn_momo_msisdn_invalid", 32).replace(/\D/g, "");
  const normalized = digits.startsWith("250")
    ? digits
    : digits.startsWith("0")
    ? `250${digits.slice(1)}`
    : `250${digits}`;
  if (!/^2507[2389][0-9]{7}$/.test(normalized)) {
    throw new Error("mtn_momo_msisdn_invalid");
  }
  return normalized;
}

function maskedIdentifier(value: unknown): string {
  const normalized = text(value, "masked_identifier_invalid", 64);
  if ((normalized.match(/[0-9]/g) ?? []).length > 4) {
    throw new Error("masked_identifier_invalid");
  }
  return normalized;
}

export const mtnMomoSmsAdapter: ConnectorAdapter<
  MtnMomoSmsConfiguration,
  MtnMomoSmsRawEvent,
  ParsedTransaction
> = {
  validateConfiguration(input) {
    const configuration = object(input, "mtn_momo_configuration_invalid");
    exactKeys(
      configuration,
      CONFIGURATION_KEYS,
      "mtn_momo_configuration_invalid",
    );
    const msisdn = normalizeRwandaMsisdn(configuration.msisdn);
    const sourceDisplayName = text(
      configuration.sourceDisplayName,
      "source_display_name_invalid",
      120,
    );
    const accountDisplayName = text(
      configuration.accountDisplayName,
      "account_display_name_invalid",
      120,
    );
    const localMsisdn = `0${msisdn.slice(3)}`;
    const sourceDisplayDigits = sourceDisplayName.replace(/\D/g, "");
    const accountDisplayDigits = accountDisplayName.replace(/\D/g, "");
    if (
      sourceDisplayDigits.includes(msisdn) ||
      sourceDisplayDigits.includes(localMsisdn) ||
      accountDisplayDigits.includes(msisdn) ||
      accountDisplayDigits.includes(localMsisdn)
    ) {
      throw new Error("display_name_contains_raw_msisdn");
    }
    return {
      msisdn,
      sourceDisplayName,
      accountDisplayName,
      maskedIdentifier: maskedIdentifier(configuration.maskedIdentifier),
    };
  },

  async testConnection(_installation, _configuration) {
    // SMS forwarding is a push connector with no upstream API to probe. The
    // actual readiness check remains the first authenticated device event.
    return await Promise.resolve({ ok: true as const });
  },

  async discoverSources(_installation, configuration) {
    return await Promise.resolve([{
      externalRef: `wallet:${configuration.msisdn}`,
      providerKey: MTN_MOMO_SMS_CONNECTOR_KEY,
      provider: "mtn_momo",
      sourceType: "mobile_money",
      displayName: configuration.sourceDisplayName,
      maskedIdentifier: configuration.maskedIdentifier,
      currency: "RWF",
      accounts: [{
        externalRef: "primary_wallet",
        displayName: configuration.accountDisplayName,
        provider: "mtn_momo",
        currency: "RWF",
      }],
    }]);
  },

  normalize(raw) {
    const parsed = parseMomoMessage(raw.message);
    return parsed ? [parsed] : [];
  },
};

export async function buildMtnMomoDiscoveryPayload(
  installation: ConnectorInstallationContext,
  input: unknown,
): Promise<ConnectorDiscoveryPayload> {
  const configuration = mtnMomoSmsAdapter.validateConfiguration(input);
  const discovered = await mtnMomoSmsAdapter.discoverSources(
    installation,
    configuration,
  );
  return await buildConnectorDiscoveryPayload(
    discovered,
    hashConnectorReference,
  );
}

export function buildMtnMomoEventEnvelope(
  raw: MtnMomoSmsRawEvent,
): ConnectorEventEnvelope<{ message: string; received_at: string | null }> {
  const message = text(raw.message, "mtn_momo_message_invalid", 5000);
  const providerEventReference = text(
    raw.providerEventReference,
    "provider_event_reference_invalid",
    128,
  );
  const sourceExternalRef = raw.sourceExternalRef == null
    ? null
    : text(raw.sourceExternalRef, "source_reference_invalid", 512);
  const accountExternalRef = raw.accountExternalRef == null
    ? null
    : text(raw.accountExternalRef, "account_reference_invalid", 512);
  if (accountExternalRef && !sourceExternalRef) {
    throw new Error("account_discriminator_requires_source");
  }

  return {
    connector_key: MTN_MOMO_SMS_CONNECTOR_KEY,
    adapter_version: MTN_MOMO_SMS_ADAPTER_VERSION,
    event_time: raw.receivedAt,
    provider_event_reference: providerEventReference,
    source_external_ref: sourceExternalRef,
    account_external_ref: accountExternalRef,
    payload: { message, received_at: raw.receivedAt },
  };
}
