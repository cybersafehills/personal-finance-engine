// Phase C: pure, dependency-injected credential/account resolution logic,
// factored out of index.ts so it can be unit-tested (blank/malformed/
// random/revoked/cross-workspace/archived-account credentials) without a
// live database or HTTP server. index.ts wires this to the real Supabase
// client; tests/connection_resolver_test.ts wires it to fakes.
//
// Never trusts anything client-supplied beyond the raw credential string
// itself - every other value (workspace_id, account_id, connection id)
// comes only from what the credential's hash resolves to in the database.
//
// Split into two phases, matching index.ts's own two-phase flow:
//   1. authenticateCredential() - cheap, runs before any request body is
//      even read. Answers only "is this credential valid at all", and
//      resolves to either a specific connection or the legacy fallback -
//      never to a specific account yet.
//   2. resolveAccountRoute() - runs later, once a momo_messages row exists
//      to attribute a resolution failure to, exactly where index.ts's
//      original single-account resolver ran. Re-checks the account live
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
};

export type AuthenticateCredentialDeps = {
  hash: (input: string) => Promise<string>;
  findConnectionByCredentialHash: (
    credentialHash: string,
  ) => Promise<IngestionConnectionRow | null>;
  legacySecret: string;
};

export type AuthenticateCredentialResult =
  | { ok: true; connection: IngestionConnectionRow }
  | { ok: true; connection: null } // authenticated via the legacy fallback
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

  if (connection) {
    return connection.status === "active"
      ? { ok: true, connection }
      : { ok: false };
  }

  const usingLegacyCredential = deps.legacySecret.length > 0 &&
    suppliedSecret === deps.legacySecret;

  return usingLegacyCredential ? { ok: true, connection: null } : {
    ok: false,
  };
}

export type ResolveAccountRouteDeps = {
  findActiveAccountById: (accountId: string) => Promise<AccountRow | null>;
  /** Legacy Phase B behavior: exactly one active account, workspace-wide. */
  findSingleLegacyActiveAccount: () => Promise<AccountRow | null | "ambiguous">;
};

export type ResolvedIngestionRoute = {
  accountId: string;
  workspaceId: string;
  ingestionConnectionId: string | null;
};

export type ResolveAccountRouteResult =
  | { ok: true; route: ResolvedIngestionRoute }
  | { ok: false; reason: "account_unavailable"; connectionId: string }
  | { ok: false; reason: "account_resolution_failed" };

export async function resolveAccountRoute(
  connection: IngestionConnectionRow | null,
  deps: ResolveAccountRouteDeps,
): Promise<ResolveAccountRouteResult> {
  if (connection) {
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
      },
    };
  }

  const legacyAccount = await deps.findSingleLegacyActiveAccount();

  if (!legacyAccount || legacyAccount === "ambiguous") {
    return { ok: false, reason: "account_resolution_failed" };
  }

  return {
    ok: true,
    route: {
      accountId: legacyAccount.id,
      workspaceId: legacyAccount.workspace_id,
      ingestionConnectionId: null,
    },
  };
}
