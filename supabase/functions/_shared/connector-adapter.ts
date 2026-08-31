export type ConnectorInstallationContext = {
  installationId: string;
  connectorKey: string;
};

export type ConnectorAdapter<Configuration, RawEvent, NormalizedEvent> = {
  validateConfiguration(input: unknown): Configuration;
  testConnection(
    installation: ConnectorInstallationContext,
    configuration: Configuration,
  ): Promise<{ ok: true } | { ok: false; errorCode: string }>;
  discoverSources(
    installation: ConnectorInstallationContext,
    configuration: Configuration,
  ): Promise<unknown>;
  pull?(
    installation: ConnectorInstallationContext,
    configuration: Configuration,
    cursor?: string,
  ): Promise<{ events: RawEvent[]; cursor?: string }>;
  normalize(raw: RawEvent): NormalizedEvent[];
};

export type ConnectorDiscoveryPayload = Array<{
  source_ref_hash: string;
  provider_key: string;
  provider: string;
  source_type: string;
  display_name: string;
  masked_identifier: string | null;
  currency: string;
  accounts: Array<{
    account_ref_hash: string;
    display_name: string;
    provider: string;
    currency: string;
  }>;
}>;

type HashReference = (scope: string, reference: string) => Promise<string>;

const SOURCE_KEYS = new Set([
  "externalRef",
  "providerKey",
  "provider",
  "sourceType",
  "displayName",
  "maskedIdentifier",
  "currency",
  "accounts",
]);
const ACCOUNT_KEYS = new Set([
  "externalRef",
  "displayName",
  "provider",
  "currency",
]);
const PROVIDERS = new Set([
  "mtn_momo",
  "airtel_money",
  "bank",
  "card",
  "cash",
  "statement",
  "other",
]);
const SOURCE_TYPES = new Set([
  "mobile_money",
  "bank_account",
  "card",
  "cash",
  "import",
]);

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}_shape_invalid`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: Set<string>,
  label: string,
): void {
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new Error(`${label}_shape_invalid`);
  }
}

function nonEmptyString(
  value: unknown,
  label: string,
  maxLength: number,
): string {
  if (typeof value !== "string") throw new Error(`${label}_invalid`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new Error(`${label}_invalid`);
  }
  return normalized;
}

function currency(value: unknown): string {
  const normalized = nonEmptyString(value, "currency", 3).toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) throw new Error("currency_invalid");
  return normalized;
}

function maskedIdentifier(value: unknown): string | null {
  if (value == null || value === "") return null;
  const normalized = nonEmptyString(value, "masked_identifier", 64);
  if ((normalized.match(/[0-9]/g) ?? []).length > 4) {
    throw new Error("masked_identifier_invalid");
  }
  return normalized;
}

async function checkedHash(
  hashReference: HashReference,
  scope: string,
  reference: string,
): Promise<string> {
  const digest = await hashReference(scope, reference);
  if (!/^[0-9a-f]{64}$/.test(digest)) {
    throw new Error("reference_hash_invalid");
  }
  return digest;
}

/**
 * Validates provider discovery at the adapter boundary and removes raw stable
 * references before returning the database payload. Unknown fields fail
 * closed, which prevents adapters from accidentally forwarding tokens,
 * balances, or provider payloads into ordinary metadata tables.
 */
export async function buildConnectorDiscoveryPayload(
  input: unknown,
  hashReference: HashReference,
): Promise<ConnectorDiscoveryPayload> {
  if (!Array.isArray(input) || input.length < 1 || input.length > 100) {
    throw new Error("discovery_sources_invalid");
  }

  const seenSources = new Set<string>();
  const result: ConnectorDiscoveryPayload = [];

  for (const candidate of input) {
    const source = record(candidate, "discovery_source");
    exactKeys(source, SOURCE_KEYS, "discovery_source");

    const externalRef = nonEmptyString(
      source.externalRef,
      "source_reference",
      512,
    );
    if (seenSources.has(externalRef)) {
      throw new Error("duplicate_source_discriminator");
    }
    seenSources.add(externalRef);

    const providerKey = nonEmptyString(source.providerKey, "provider_key", 64);
    if (!/^[a-z][a-z0-9_]{1,63}$/.test(providerKey)) {
      throw new Error("provider_key_invalid");
    }
    const provider = nonEmptyString(source.provider, "provider", 32);
    if (!PROVIDERS.has(provider)) throw new Error("provider_invalid");
    const sourceType = nonEmptyString(source.sourceType, "source_type", 32);
    if (!SOURCE_TYPES.has(sourceType)) throw new Error("source_type_invalid");

    if (
      !Array.isArray(source.accounts) || source.accounts.length < 1 ||
      source.accounts.length > 100
    ) {
      throw new Error("discovery_accounts_invalid");
    }

    const seenAccounts = new Set<string>();
    const accounts: ConnectorDiscoveryPayload[number]["accounts"] = [];

    for (const accountCandidate of source.accounts) {
      const account = record(accountCandidate, "discovery_account");
      exactKeys(account, ACCOUNT_KEYS, "discovery_account");
      const accountExternalRef = nonEmptyString(
        account.externalRef,
        "account_reference",
        512,
      );
      if (seenAccounts.has(accountExternalRef)) {
        throw new Error("duplicate_account_discriminator");
      }
      seenAccounts.add(accountExternalRef);
      const accountProvider = nonEmptyString(
        account.provider,
        "account_provider",
        32,
      );
      if (!PROVIDERS.has(accountProvider)) {
        throw new Error("account_provider_invalid");
      }

      accounts.push({
        account_ref_hash: await checkedHash(
          hashReference,
          `account:${externalRef}`,
          accountExternalRef,
        ),
        display_name: nonEmptyString(
          account.displayName,
          "account_display_name",
          120,
        ),
        provider: accountProvider,
        currency: currency(account.currency),
      });
    }

    accounts.sort((a, b) =>
      a.account_ref_hash.localeCompare(b.account_ref_hash)
    );
    result.push({
      source_ref_hash: await checkedHash(
        hashReference,
        "source",
        externalRef,
      ),
      provider_key: providerKey,
      provider,
      source_type: sourceType,
      display_name: nonEmptyString(
        source.displayName,
        "source_display_name",
        120,
      ),
      masked_identifier: maskedIdentifier(source.maskedIdentifier),
      currency: currency(source.currency),
      accounts,
    });
  }

  result.sort((a, b) => a.source_ref_hash.localeCompare(b.source_ref_hash));
  return result;
}
