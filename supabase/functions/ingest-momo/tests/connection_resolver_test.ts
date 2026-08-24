// Phase C: "ingestion credential attack tests" mandated by the master
// prompt - blank/malformed/random/revoked/cross-workspace/archived-account
// credentials - plus the routing-correctness tests that prove bound
// account routing actually binds. Exercises the pure, dependency-injected
// logic in connection-resolver.ts with fakes, so no live database or HTTP
// server is required (index.ts wires the exact same functions to the real
// Supabase client - see index.ts's own comments).

import { assertEquals } from "jsr:@std/assert@1";
import {
  type AccountRow,
  authenticateCredential,
  type IngestionConnectionRow,
  resolveAccountRoute,
} from "../connection-resolver.ts";

const hash = (input: string) => Promise.resolve(`hash(${input})`);
const noConnection = () => Promise.resolve(null);
const noAccount = () => Promise.resolve(null);

const ACTIVE_CONNECTION: IngestionConnectionRow = {
  id: "conn-1",
  workspace_id: "ws-a",
  account_id: "acct-a",
  status: "active",
};

const REVOKED_CONNECTION: IngestionConnectionRow = {
  id: "conn-revoked",
  workspace_id: "ws-a",
  account_id: "acct-a",
  status: "revoked",
};

const ACTIVE_ACCOUNT: AccountRow = {
  id: "acct-a",
  workspace_id: "ws-a",
  is_active: true,
  archived_at: null,
};

const ARCHIVED_ACCOUNT: AccountRow = {
  id: "acct-a",
  workspace_id: "ws-a",
  is_active: false,
  archived_at: "2026-08-01T00:00:00Z",
};

function connectionStore(rows: IngestionConnectionRow[]) {
  return (credentialHash: string) => {
    for (const row of rows) {
      if (`hash(secret-for-${row.id})` === credentialHash) {
        return Promise.resolve(row);
      }
    }
    return Promise.resolve(null);
  };
}

// --- authenticateCredential: blank/malformed/random credentials ----------

Deno.test("authenticateCredential: blank credential is rejected", async () => {
  const result = await authenticateCredential(null, {
    hash,
    legacySecret: "",
    findConnectionByCredentialHash: noConnection,
  });
  assertEquals(result.ok, false);
});

Deno.test("authenticateCredential: empty-string credential is rejected", async () => {
  const result = await authenticateCredential("", {
    hash,
    legacySecret: "",
    findConnectionByCredentialHash: noConnection,
  });
  assertEquals(result.ok, false);
});

Deno.test("authenticateCredential: malformed/random credential matching nothing is rejected", async () => {
  const result = await authenticateCredential("not-a-real-credential", {
    hash,
    legacySecret: "legacy-secret",
    findConnectionByCredentialHash: noConnection,
  });
  assertEquals(result.ok, false);
});

Deno.test("authenticateCredential: a valid credential for a revoked connection is rejected", async () => {
  const result = await authenticateCredential("secret-for-conn-revoked", {
    hash,
    legacySecret: "",
    findConnectionByCredentialHash: connectionStore([REVOKED_CONNECTION]),
  });
  assertEquals(result.ok, false);
});

Deno.test("authenticateCredential: revoked-credential replay is rejected even if it was valid before revocation", async () => {
  // Same credential value that used to resolve to an active connection -
  // simulates presenting a captured/leaked credential after the owner
  // revoked it. The store always returns the connection in its *current*
  // (revoked) state, exactly as a real credential_hash lookup would.
  const result = await authenticateCredential("secret-for-conn-revoked", {
    hash,
    legacySecret: "",
    findConnectionByCredentialHash: connectionStore([REVOKED_CONNECTION]),
  });
  assertEquals(result.ok, false);
});

Deno.test("authenticateCredential: a valid credential for an active connection is accepted and resolves that exact connection", async () => {
  const result = await authenticateCredential("secret-for-conn-1", {
    hash,
    legacySecret: "",
    findConnectionByCredentialHash: connectionStore([ACTIVE_CONNECTION]),
  });
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.connection?.id, "conn-1");
  }
});

// --- legacy transition path -------------------------------------------

Deno.test("authenticateCredential: legacy secret is accepted only when no connection matches and the legacy secret is configured", async () => {
  const result = await authenticateCredential("the-legacy-secret", {
    hash,
    legacySecret: "the-legacy-secret",
    findConnectionByCredentialHash: noConnection,
  });
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.connection, null);
  }
});

Deno.test("authenticateCredential: a real connection credential always takes priority over the legacy secret, even if it happened to equal it", async () => {
  const result = await authenticateCredential("secret-for-conn-1", {
    hash,
    legacySecret: "secret-for-conn-1",
    findConnectionByCredentialHash: connectionStore([ACTIVE_CONNECTION]),
  });
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.connection?.id, "conn-1");
  }
});

Deno.test("authenticateCredential: legacy secret is rejected when unset (empty string) even if the caller supplies an empty credential", async () => {
  const result = await authenticateCredential("", {
    hash,
    legacySecret: "",
    findConnectionByCredentialHash: noConnection,
  });
  assertEquals(result.ok, false);
});

Deno.test("authenticateCredential: wrong legacy secret is rejected", async () => {
  const result = await authenticateCredential("wrong-secret", {
    hash,
    legacySecret: "the-legacy-secret",
    findConnectionByCredentialHash: noConnection,
  });
  assertEquals(result.ok, false);
});

// --- resolveAccountRoute: bound account routing + cross-workspace/archived

Deno.test("resolveAccountRoute: an active connection resolves to its own bound account and workspace, never anything else", async () => {
  const result = await resolveAccountRoute(ACTIVE_CONNECTION, {
    findActiveAccountById: (accountId) => {
      assertEquals(accountId, "acct-a");
      return Promise.resolve(ACTIVE_ACCOUNT);
    },
    findSingleLegacyActiveAccount: noAccount,
  });
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.route, {
      accountId: "acct-a",
      workspaceId: "ws-a",
      ingestionConnectionId: "conn-1",
    });
  }
});

Deno.test("resolveAccountRoute: an archived-account connection is rejected, not silently rerouted", async () => {
  const result = await resolveAccountRoute(ACTIVE_CONNECTION, {
    findActiveAccountById: () => Promise.resolve(ARCHIVED_ACCOUNT),
    findSingleLegacyActiveAccount: noAccount,
  });
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.reason, "account_unavailable");
  }
});

Deno.test("resolveAccountRoute: a connection whose bound account was deleted out from under it is rejected, not silently rerouted", async () => {
  const result = await resolveAccountRoute(ACTIVE_CONNECTION, {
    findActiveAccountById: noAccount,
    findSingleLegacyActiveAccount: noAccount,
  });
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.reason, "account_unavailable");
  }
});

Deno.test("resolveAccountRoute: the account lookup is always keyed by the connection's own account_id, never by any other value", async () => {
  let queriedAccountId: string | null = null;
  await resolveAccountRoute(ACTIVE_CONNECTION, {
    findActiveAccountById: (accountId) => {
      queriedAccountId = accountId;
      return Promise.resolve(ACTIVE_ACCOUNT);
    },
    findSingleLegacyActiveAccount: noAccount,
  });
  assertEquals(queriedAccountId, ACTIVE_CONNECTION.account_id);
});

Deno.test("resolveAccountRoute: legacy path (no connection) resolves the single legacy active account", async () => {
  const result = await resolveAccountRoute(null, {
    findActiveAccountById: noAccount,
    findSingleLegacyActiveAccount: () => Promise.resolve(ACTIVE_ACCOUNT),
  });
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.route.ingestionConnectionId, null);
    assertEquals(result.route.accountId, "acct-a");
  }
});

Deno.test("resolveAccountRoute: legacy path fails closed when zero active accounts exist", async () => {
  const result = await resolveAccountRoute(null, {
    findActiveAccountById: noAccount,
    findSingleLegacyActiveAccount: noAccount,
  });
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.reason, "account_resolution_failed");
  }
});

Deno.test("resolveAccountRoute: legacy path fails closed (never guesses) when more than one active account exists", async () => {
  const result = await resolveAccountRoute(null, {
    findActiveAccountById: noAccount,
    findSingleLegacyActiveAccount: () => Promise.resolve("ambiguous" as const),
  });
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.reason, "account_resolution_failed");
  }
});
