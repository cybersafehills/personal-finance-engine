/**
 * Pure Stage D projection from canonical connector rows into the hierarchy the
 * settings UI needs. Keeping this separate from Supabase makes multi-source,
 * multi-account, and credential-scope behavior deterministic and testable
 * before the production read cutover.
 */

export type ConnectorInstallationRecord = {
  id: string;
  connector_key: string;
  display_name: string;
  status:
    | "setup"
    | "testing"
    | "healthy"
    | "stale"
    | "paused"
    | "error"
    | "revoked";
  auth_mode: "device_secret" | "oauth" | "api_key" | "mailbox" | "none";
  last_attempt_at: string | null;
  last_success_at: string | null;
  last_error_code: string | null;
  revoked_at: string | null;
  created_at: string;
};

export type ConnectorSourceRecord = {
  id: string;
  connector_installation_id: string | null;
  provider: string;
  provider_key: string | null;
  source_type: string;
  display_name: string;
  masked_identifier: string | null;
  currency: string;
  status: "active" | "paused" | "archived";
  created_at: string;
};

export type ConnectorAccountRecord = {
  id: string;
  financial_source_id: string | null;
  workspace_id: string;
  name: string;
  provider: string;
  currency: string;
  is_active: boolean;
  is_primary: boolean;
  archived_at: string | null;
  created_at: string;
};

export type DeviceCredentialRecord = {
  id: string;
  connector_installation_id: string;
  account_id: string | null;
  label: string;
  credential_prefix: string;
  status: "active" | "paused" | "revoked";
  last_used_at: string | null;
  expires_at: string | null;
  rotated_from_id: string | null;
  created_at: string;
  paused_at: string | null;
  revoked_at: string | null;
};

export type CanonicalConnectorAccount = {
  id: string;
  workspaceId: string;
  name: string;
  provider: string;
  currency: string;
  isActive: boolean;
  isPrimary: boolean;
  archivedAt: string | null;
};

export type CanonicalConnectorSource = {
  id: string;
  provider: string;
  providerKey: string | null;
  sourceType: string;
  displayName: string;
  maskedIdentifier: string | null;
  currency: string;
  status: "active" | "paused" | "archived";
  accounts: CanonicalConnectorAccount[];
};

export type CanonicalCredentialScope =
  | { kind: "installation" }
  | { kind: "account"; accountId: string; accountName: string }
  | { kind: "unresolved_account"; accountId: string };

export type CanonicalDeviceCredential = {
  id: string;
  label: string;
  credentialPrefix: string;
  status: "active" | "paused" | "revoked";
  scope: CanonicalCredentialScope;
  lastUsedAt: string | null;
  expiresAt: string | null;
  rotatedFromId: string | null;
  pausedAt: string | null;
  revokedAt: string | null;
};

export type ConnectorAdapterCanaryStatus = {
  enabled: boolean;
  paired_at: string;
  enabled_at: string | null;
  observation_count: number;
  match_count: number;
  mismatch_count: number;
  resolver_error_count: number;
  envelope_error_count: number;
  ready_for_broader_rollout: boolean;
};

export type CanonicalConnectorInstallation = {
  id: string;
  connectorKey: string;
  displayName: string;
  status: ConnectorInstallationRecord["status"];
  authMode: ConnectorInstallationRecord["auth_mode"];
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastErrorCode: string | null;
  revokedAt: string | null;
  sources: CanonicalConnectorSource[];
  credentials: CanonicalDeviceCredential[];
  adapterCanary: ConnectorAdapterCanaryStatus | null;
};

export type CanonicalConnectorRows = {
  installations: ConnectorInstallationRecord[];
  sources: ConnectorSourceRecord[];
  accounts: ConnectorAccountRecord[];
  credentials: DeviceCredentialRecord[];
  adapterCanaries?: ReadonlyMap<string, ConnectorAdapterCanaryStatus>;
};

function byCreatedAt<T extends { created_at: string }>(a: T, b: T): number {
  return a.created_at.localeCompare(b.created_at) ||
    ("id" in a && "id" in b ? String(a.id).localeCompare(String(b.id)) : 0);
}

export function buildCanonicalConnectorReadModel(
  rows: CanonicalConnectorRows,
): CanonicalConnectorInstallation[] {
  const installations = [...rows.installations].sort(byCreatedAt);
  const installationIds = new Set(installations.map((row) => row.id));
  const sourceRecords = [...rows.sources]
    .filter((row) =>
      row.connector_installation_id !== null &&
      installationIds.has(row.connector_installation_id)
    )
    .sort(byCreatedAt);
  const sourceById = new Map(sourceRecords.map((row) => [row.id, row]));
  const accountsBySource = new Map<string, ConnectorAccountRecord[]>();

  for (const account of [...rows.accounts].sort(byCreatedAt)) {
    if (
      !account.financial_source_id ||
      !sourceById.has(account.financial_source_id)
    ) {
      continue;
    }
    const accounts = accountsBySource.get(account.financial_source_id) ?? [];
    accounts.push(account);
    accountsBySource.set(account.financial_source_id, accounts);
  }

  const accountById = new Map(
    [...accountsBySource.values()].flat().map((
      account,
    ) => [account.id, account]),
  );

  return installations.map((installation) => {
    const sources = sourceRecords
      .filter((source) => source.connector_installation_id === installation.id)
      .map((source): CanonicalConnectorSource => ({
        id: source.id,
        provider: source.provider,
        providerKey: source.provider_key,
        sourceType: source.source_type,
        displayName: source.display_name,
        maskedIdentifier: source.masked_identifier,
        currency: source.currency,
        status: source.status,
        accounts: (accountsBySource.get(source.id) ?? []).map((account) => ({
          id: account.id,
          workspaceId: account.workspace_id,
          name: account.name,
          provider: account.provider,
          currency: account.currency,
          isActive: account.is_active,
          isPrimary: account.is_primary,
          archivedAt: account.archived_at,
        })),
      }));

    const credentials = [...rows.credentials]
      .filter((credential) =>
        credential.connector_installation_id === installation.id
      )
      .sort(byCreatedAt)
      .map((credential): CanonicalDeviceCredential => {
        let scope: CanonicalCredentialScope = { kind: "installation" };

        if (credential.account_id) {
          const account = accountById.get(credential.account_id);
          const source = account?.financial_source_id
            ? sourceById.get(account.financial_source_id)
            : null;
          scope =
            account && source?.connector_installation_id === installation.id
              ? {
                kind: "account",
                accountId: account.id,
                accountName: account.name,
              }
              : {
                kind: "unresolved_account",
                accountId: credential.account_id,
              };
        }

        return {
          id: credential.id,
          label: credential.label,
          credentialPrefix: credential.credential_prefix,
          status: credential.status,
          scope,
          lastUsedAt: credential.last_used_at,
          expiresAt: credential.expires_at,
          rotatedFromId: credential.rotated_from_id,
          pausedAt: credential.paused_at,
          revokedAt: credential.revoked_at,
        };
      });

    return {
      id: installation.id,
      connectorKey: installation.connector_key,
      displayName: installation.display_name,
      status: installation.status,
      authMode: installation.auth_mode,
      lastAttemptAt: installation.last_attempt_at,
      lastSuccessAt: installation.last_success_at,
      lastErrorCode: installation.last_error_code,
      revokedAt: installation.revoked_at,
      sources,
      credentials,
      adapterCanary: rows.adapterCanaries?.get(installation.id) ?? null,
    };
  });
}
