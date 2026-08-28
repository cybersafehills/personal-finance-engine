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
  status: "active" | "revoked";
};

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
