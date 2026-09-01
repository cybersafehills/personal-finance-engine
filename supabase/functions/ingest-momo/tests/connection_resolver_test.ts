// Phase C: "ingestion credential attack tests" mandated by the master
// prompt - blank/malformed/random/revoked/cross-workspace/archived-account
// credentials - plus the routing-correctness tests that prove bound
// account routing actually binds. Exercises the pure, dependency-injected
// logic in connection-resolver.ts with fakes, so no live database or HTTP
// server is required (index.ts wires the exact same functions to the real
// Supabase client - see index.ts's own comments).

import { assertEquals } from "jsr:@std/assert@1";
import {
  acceptCanonicalShadow,
  acceptDeterministicEventRoute,
  type AccountRow,
  authenticateCredential,
  canonicalIngestionEnabled,
  type IngestionConnectionRow,
  installationAdapterCanaryEnabled,
  installationIngestionRolloutsEnabled,
  mtnMomoAdapterEnabled,
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
  connector_installation_id: "install-1",
  device_credential_id: "credential-1",
};

const REVOKED_CONNECTION: IngestionConnectionRow = {
  id: "conn-revoked",
  workspace_id: "ws-a",
  account_id: "acct-a",
  status: "revoked",
  connector_installation_id: "install-revoked",
  device_credential_id: "credential-revoked",
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

const MATCHING_SHADOW = {
  matches_legacy: true,
  mismatch_code: null,
  connector_installation_id: "install-1",
  device_credential_id: "credential-1",
  workspace_id: "ws-a",
  account_id: "acct-a",
  financial_source_id: "source-a",
};

Deno.test("canonicalIngestionEnabled: only the exact enabled value activates cutover", () => {
  assertEquals(canonicalIngestionEnabled("enabled"), true);
  assertEquals(canonicalIngestionEnabled("ENABLED"), false);
  assertEquals(canonicalIngestionEnabled("true"), false);
  assertEquals(canonicalIngestionEnabled(undefined), false);
});

Deno.test("installationIngestionRolloutsEnabled: installation control plane is exact-match and default-off", () => {
  assertEquals(installationIngestionRolloutsEnabled("enabled"), true);
  assertEquals(installationIngestionRolloutsEnabled("ENABLED"), false);
  assertEquals(installationIngestionRolloutsEnabled("true"), false);
  assertEquals(installationIngestionRolloutsEnabled(undefined), false);
});

Deno.test("mtnMomoAdapterEnabled: provider rollout is exact-match and default-off", () => {
  assertEquals(mtnMomoAdapterEnabled("enabled"), true);
  assertEquals(mtnMomoAdapterEnabled("ENABLED"), false);
  assertEquals(mtnMomoAdapterEnabled("true"), false);
  assertEquals(mtnMomoAdapterEnabled(undefined), false);
});

Deno.test("installationAdapterCanaryEnabled: only an explicit enabled row activates an installation", () => {
  assertEquals(installationAdapterCanaryEnabled(null), false);
  assertEquals(installationAdapterCanaryEnabled({ enabled: false }), false);
  assertEquals(installationAdapterCanaryEnabled({ enabled: true }), true);
});

Deno.test("acceptCanonicalShadow: accepts only an exact canonical mirror", () => {
  assertEquals(acceptCanonicalShadow(ACTIVE_CONNECTION, MATCHING_SHADOW), {
    ok: true,
    route: {
      connectorInstallationId: "install-1",
      deviceCredentialId: "credential-1",
      financialSourceId: "source-a",
    },
  });
});

Deno.test("acceptCanonicalShadow: rejects resolver and shape mismatches", () => {
  assertEquals(
    acceptCanonicalShadow(ACTIVE_CONNECTION, {
      ...MATCHING_SHADOW,
      matches_legacy: false,
      mismatch_code: "account_mismatch",
    }),
    { ok: false, mismatchCode: "account_mismatch" },
  );
  assertEquals(
    acceptCanonicalShadow(ACTIVE_CONNECTION, {
      ...MATCHING_SHADOW,
      workspace_id: "ws-b",
    }),
    { ok: false, mismatchCode: "canonical_shadow_shape_mismatch" },
  );
  assertEquals(acceptCanonicalShadow(ACTIVE_CONNECTION, null), {
    ok: false,
    mismatchCode: "canonical_shadow_missing",
  });
});

Deno.test("acceptDeterministicEventRoute: accepts only the existing canonical route", () => {
  const canonicalRoute = {
    connectorInstallationId: "install-1",
    deviceCredentialId: "credential-1",
    financialSourceId: "source-a",
  };
  const route = {
    connector_installation_id: "install-1",
    device_credential_id: "credential-1",
    financial_source_id: "source-a",
    account_id: "acct-a",
    workspace_id: "ws-a",
  };

  assertEquals(
    acceptDeterministicEventRoute(ACTIVE_CONNECTION, canonicalRoute, route),
    { ok: true },
  );
  assertEquals(
    acceptDeterministicEventRoute(ACTIVE_CONNECTION, canonicalRoute, {
      ...route,
      account_id: "acct-b",
    }),
    { ok: false, mismatchCode: "adapter_account_mismatch" },
  );
  assertEquals(
    acceptDeterministicEventRoute(ACTIVE_CONNECTION, canonicalRoute, null),
    { ok: false, mismatchCode: "adapter_route_missing" },
  );
});

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
    findConnectionByCredentialHash: noConnection,
  });
  assertEquals(result.ok, false);
});

Deno.test("authenticateCredential: empty-string credential is rejected", async () => {
  const result = await authenticateCredential("", {
    hash,
    findConnectionByCredentialHash: noConnection,
  });
  assertEquals(result.ok, false);
});

Deno.test("authenticateCredential: malformed/random credential matching nothing is rejected", async () => {
  const result = await authenticateCredential("not-a-real-credential", {
    hash,
    findConnectionByCredentialHash: noConnection,
  });
  assertEquals(result.ok, false);
});

Deno.test("authenticateCredential: a valid credential for a revoked connection is rejected", async () => {
  const result = await authenticateCredential("secret-for-conn-revoked", {
    hash,
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
    findConnectionByCredentialHash: connectionStore([REVOKED_CONNECTION]),
  });
  assertEquals(result.ok, false);
});

Deno.test("authenticateCredential: a valid credential for an active connection is accepted and resolves that exact connection", async () => {
  const result = await authenticateCredential("secret-for-conn-1", {
    hash,
    findConnectionByCredentialHash: connectionStore([ACTIVE_CONNECTION]),
  });
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.connection.id, "conn-1");
  }
});

// --- resolveAccountRoute: bound account routing + cross-workspace/archived

Deno.test("resolveAccountRoute: an active connection resolves to its own bound account and workspace, never anything else", async () => {
  const result = await resolveAccountRoute(ACTIVE_CONNECTION, {
    findActiveAccountById: (accountId) => {
      assertEquals(accountId, "acct-a");
      return Promise.resolve(ACTIVE_ACCOUNT);
    },
  });
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.route, {
      accountId: "acct-a",
      workspaceId: "ws-a",
      ingestionConnectionId: "conn-1",
      financialSourceId: null,
      sourceMaskedIdentifier: null,
    });
  }
});

Deno.test("resolveAccountRoute: carries the routed account's linked financial source + masked identifier through to the route (Phase U provenance)", async () => {
  const result = await resolveAccountRoute(ACTIVE_CONNECTION, {
    findActiveAccountById: () =>
      Promise.resolve({
        ...ACTIVE_ACCOUNT,
        financial_source_id: "src-a",
        source_masked_identifier: "MTN ...4821",
      }),
  });
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.route.financialSourceId, "src-a");
    assertEquals(result.route.sourceMaskedIdentifier, "MTN ...4821");
    // Routing itself is unchanged - still the connection's bound account.
    assertEquals(result.route.accountId, "acct-a");
    assertEquals(result.route.workspaceId, "ws-a");
  }
});

Deno.test("resolveAccountRoute: an archived-account connection is rejected, not silently rerouted", async () => {
  const result = await resolveAccountRoute(ACTIVE_CONNECTION, {
    findActiveAccountById: () => Promise.resolve(ARCHIVED_ACCOUNT),
  });
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.reason, "account_unavailable");
  }
});

Deno.test("resolveAccountRoute: a connection whose bound account was deleted out from under it is rejected, not silently rerouted", async () => {
  const result = await resolveAccountRoute(ACTIVE_CONNECTION, {
    findActiveAccountById: noAccount,
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
  });
  assertEquals(queriedAccountId, ACTIVE_CONNECTION.account_id);
});
