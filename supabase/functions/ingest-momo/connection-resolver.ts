// Pure, dependency-injected credential/account resolution logic, factored
// out of index.ts so it can be unit-tested (blank/malformed/random/revoked/
// cross-workspace/archived-account credentials) without a live database or
// HTTP server. index.ts wires this to the real Supabase client;
// tests/connection_resolver_test.ts wires it to fakes.
//
// Never trusts anything client-supplied beyond the raw credential string
// itself - every other value (workspace_id, account_id, connection id)
// comes only from what the credential's hash resolves to in the database.
//
// Split into two phases, matching index.ts's own two-phase flow:
//   1. authenticateCredential() - cheap, runs before any request body is
//      even read. Answers only "is this credential valid at all", and
//      resolves to the matching connection.
//   2. resolveAccountRoute() - runs later, once a momo_messages row exists
//      to attribute a resolution failure to. Re-checks the account live
//      (never trusts a possibly-stale connection row) and resolves the
//      final workspace_id/account_id/ingestion_connection_id used for the
//      transaction insert.

export type IngestionConnectionRow = {
  id: string;
  workspace_id: string;
  account_id: string;
  // 'paused' is the reversible middle state (Phase U PR4). Only 'active'
  // authenticates - authenticateCredential rejects both 'paused' and
  // 'revoked' identically, so a paused device silently stops ingesting
  // until it is resumed.
  status: "active" | "paused" | "revoked";
  connector_installation_id: string | null;
  device_credential_id: string | null;
};

export type CanonicalShadowRow = {
  matches_legacy: boolean;
  mismatch_code: string | null;
  connector_installation_id: string | null;
  device_credential_id: string | null;
  workspace_id: string | null;
  account_id: string | null;
  financial_source_id: string | null;
};

export type CanonicalShadowRoute = {
  connectorInstallationId: string;
  deviceCredentialId: string;
  financialSourceId: string;
};

export type DeterministicEventRouteRow = {
  connector_installation_id: string;
  device_credential_id: string;
  financial_source_id: string;
  account_id: string;
  workspace_id: string;
};

export function acceptCanonicalShadow(
  connection: IngestionConnectionRow,
  shadow: CanonicalShadowRow | null,
): { ok: true; route: CanonicalShadowRoute } | {
  ok: false;
  mismatchCode: string;
} {
  if (!shadow) return { ok: false, mismatchCode: "canonical_shadow_missing" };
  if (!shadow.matches_legacy) {
    return {
      ok: false,
      mismatchCode: shadow.mismatch_code ?? "canonical_shadow_mismatch",
    };
  }
  if (
    !connection.connector_installation_id ||
    !connection.device_credential_id ||
    shadow.connector_installation_id !== connection.connector_installation_id ||
    shadow.device_credential_id !== connection.device_credential_id ||
    shadow.workspace_id !== connection.workspace_id ||
    shadow.account_id !== connection.account_id ||
    !shadow.financial_source_id
  ) {
    return { ok: false, mismatchCode: "canonical_shadow_shape_mismatch" };
  }
  return {
    ok: true,
    route: {
      connectorInstallationId: shadow.connector_installation_id,
      deviceCredentialId: shadow.device_credential_id,
      financialSourceId: shadow.financial_source_id,
    },
  };
}

export type AccountRow = {
  id: string;
  workspace_id: string;
  is_active: boolean;
  archived_at: string | null;
  // Phase U (PR2): the financial_sources row this account was linked to by
  // the Phase Q backfill, plus its masked identifier - carried through so
  // ingestion can stamp transactions.financial_source_id and feed the
  // duplicate-detection fingerprint. Nullable: the seed account created by
  // migrations alone has no source, and pre-Phase-Q accounts may not yet.
  financial_source_id?: string | null;
  source_masked_identifier?: string | null;
};

export type AuthenticateCredentialDeps = {
  hash: (input: string) => Promise<string>;
  findConnectionByCredentialHash: (
    credentialHash: string,
  ) => Promise<IngestionConnectionRow | null>;
};

export type AuthenticateCredentialResult =
  | { ok: true; connection: IngestionConnectionRow }
  | { ok: false };

export function canonicalIngestionEnabled(value: string | undefined): boolean {
  return value === "enabled";
}

export function installationIngestionRolloutsEnabled(
  value: string | undefined,
): boolean {
  return value === "enabled";
}

export function mtnMomoAdapterEnabled(value: string | undefined): boolean {
  return value === "enabled";
}

export function installationAdapterCanaryEnabled(
  row: { enabled: boolean } | null,
): boolean {
  return row?.enabled === true;
}

export function acceptDeterministicEventRoute(
  connection: IngestionConnectionRow,
  canonicalRoute: CanonicalShadowRoute,
  route: DeterministicEventRouteRow | null,
): { ok: true } | { ok: false; mismatchCode: string } {
  if (!route) {
    return { ok: false, mismatchCode: "adapter_route_missing" };
  }
  if (
    route.connector_installation_id !==
      canonicalRoute.connectorInstallationId
  ) {
    return { ok: false, mismatchCode: "adapter_installation_mismatch" };
  }
  if (route.device_credential_id !== canonicalRoute.deviceCredentialId) {
    return { ok: false, mismatchCode: "adapter_credential_mismatch" };
  }
  if (route.financial_source_id !== canonicalRoute.financialSourceId) {
    return { ok: false, mismatchCode: "adapter_source_mismatch" };
  }
  if (route.account_id !== connection.account_id) {
    return { ok: false, mismatchCode: "adapter_account_mismatch" };
  }
  if (route.workspace_id !== connection.workspace_id) {
    return { ok: false, mismatchCode: "adapter_workspace_mismatch" };
  }
  return { ok: true };
}

export async function authenticateCredential(
  suppliedSecret: string | null,
  deps: AuthenticateCredentialDeps,
): Promise<AuthenticateCredentialResult> {
  if (!suppliedSecret) {
    return { ok: false };
  }

  const credentialHash = await deps.hash(suppliedSecret);
  const connection = await deps.findConnectionByCredentialHash(
    credentialHash,
  );

  if (!connection || connection.status !== "active") {
    return { ok: false };
  }

  return { ok: true, connection };
}

export type ResolveAccountRouteDeps = {
  findActiveAccountById: (accountId: string) => Promise<AccountRow | null>;
};

export type ResolvedIngestionRoute = {
  accountId: string;
  workspaceId: string;
  ingestionConnectionId: string;
  financialSourceId: string | null;
  sourceMaskedIdentifier: string | null;
};

export type ResolveAccountRouteResult =
  | { ok: true; route: ResolvedIngestionRoute }
  | { ok: false; reason: "account_unavailable"; connectionId: string };

export async function resolveAccountRoute(
  connection: IngestionConnectionRow,
  deps: ResolveAccountRouteDeps,
): Promise<ResolveAccountRouteResult> {
  const account = await deps.findActiveAccountById(connection.account_id);

  if (!account || !account.is_active || account.archived_at) {
    return {
      ok: false,
      reason: "account_unavailable",
      connectionId: connection.id,
    };
  }

  return {
    ok: true,
    route: {
      accountId: account.id,
      workspaceId: account.workspace_id,
      ingestionConnectionId: connection.id,
      financialSourceId: account.financial_source_id ?? null,
      sourceMaskedIdentifier: account.source_masked_identifier ?? null,
    },
  };
}
