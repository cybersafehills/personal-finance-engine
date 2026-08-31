import { assertEquals } from "jsr:@std/assert@1";
import {
  buildCanonicalConnectorReadModel,
  type CanonicalConnectorRows,
} from "./connector-read-model.ts";

const rows: CanonicalConnectorRows = {
  installations: [
    {
      id: "install-bank",
      connector_key: "bank_open_api_v1",
      display_name: "Household bank",
      status: "healthy",
      auth_mode: "oauth",
      last_attempt_at: "2026-08-31T08:00:00Z",
      last_success_at: "2026-08-31T08:00:00Z",
      last_error_code: null,
      revoked_at: null,
      created_at: "2026-08-01T00:00:00Z",
    },
    {
      id: "install-sms",
      connector_key: "mtn_momo_sms_v1",
      display_name: "My phone",
      status: "healthy",
      auth_mode: "device_secret",
      last_attempt_at: null,
      last_success_at: "2026-08-30T08:00:00Z",
      last_error_code: null,
      revoked_at: null,
      created_at: "2026-08-02T00:00:00Z",
    },
  ],
  sources: [
    {
      id: "source-current",
      connector_installation_id: "install-bank",
      provider: "bank",
      provider_key: "example_bank_rw",
      source_type: "bank_account",
      display_name: "Current account",
      masked_identifier: "•••• 1001",
      currency: "RWF",
      status: "active",
      created_at: "2026-08-01T01:00:00Z",
    },
    {
      id: "source-savings",
      connector_installation_id: "install-bank",
      provider: "bank",
      provider_key: "example_bank_rw",
      source_type: "bank_account",
      display_name: "Savings account",
      masked_identifier: "•••• 2002",
      currency: "RWF",
      status: "active",
      created_at: "2026-08-01T02:00:00Z",
    },
    {
      id: "source-momo",
      connector_installation_id: "install-sms",
      provider: "mtn_momo",
      provider_key: "mtn_rw",
      source_type: "mobile_money",
      display_name: "MoMo wallet",
      masked_identifier: "•••• 4821",
      currency: "RWF",
      status: "active",
      created_at: "2026-08-02T01:00:00Z",
    },
  ],
  accounts: [
    {
      id: "account-current",
      financial_source_id: "source-current",
      workspace_id: "workspace-household",
      name: "Household current",
      provider: "bank",
      currency: "RWF",
      is_active: true,
      is_primary: true,
      archived_at: null,
      created_at: "2026-08-01T03:00:00Z",
    },
    {
      id: "account-savings",
      financial_source_id: "source-savings",
      workspace_id: "workspace-personal",
      name: "Personal savings",
      provider: "bank",
      currency: "RWF",
      is_active: true,
      is_primary: false,
      archived_at: null,
      created_at: "2026-08-01T04:00:00Z",
    },
    {
      id: "account-momo",
      financial_source_id: "source-momo",
      workspace_id: "workspace-personal",
      name: "My MoMo",
      provider: "mtn_momo",
      currency: "RWF",
      is_active: true,
      is_primary: true,
      archived_at: null,
      created_at: "2026-08-02T02:00:00Z",
    },
  ],
  credentials: [
    {
      id: "credential-current",
      connector_installation_id: "install-bank",
      account_id: "account-current",
      label: "Current-account agent",
      credential_prefix: "pfe_curr",
      status: "active",
      last_used_at: null,
      expires_at: null,
      rotated_from_id: null,
      created_at: "2026-08-01T05:00:00Z",
      paused_at: null,
      revoked_at: null,
    },
    {
      id: "credential-savings",
      connector_installation_id: "install-bank",
      account_id: "account-savings",
      label: "Savings agent",
      credential_prefix: "pfe_save",
      status: "active",
      last_used_at: null,
      expires_at: null,
      rotated_from_id: null,
      created_at: "2026-08-01T06:00:00Z",
      paused_at: null,
      revoked_at: null,
    },
    {
      id: "credential-phone",
      connector_installation_id: "install-sms",
      account_id: null,
      label: "iPhone",
      credential_prefix: "pfe_momo",
      status: "active",
      last_used_at: "2026-08-30T08:00:00Z",
      expires_at: null,
      rotated_from_id: null,
      created_at: "2026-08-02T03:00:00Z",
      paused_at: null,
      revoked_at: null,
    },
  ],
};

Deno.test("canonical connector projection preserves one installation with multiple sources, accounts, and scoped credentials", () => {
  const model = buildCanonicalConnectorReadModel(rows);

  assertEquals(model.length, 2);
  assertEquals(model[0].id, "install-bank");
  assertEquals(model[0].sources.map((source) => source.id), [
    "source-current",
    "source-savings",
  ]);
  assertEquals(model[0].sources.map((source) => source.accounts[0].id), [
    "account-current",
    "account-savings",
  ]);
  assertEquals(model[0].credentials.map((credential) => credential.scope), [
    {
      kind: "account",
      accountId: "account-current",
      accountName: "Household current",
    },
    {
      kind: "account",
      accountId: "account-savings",
      accountName: "Personal savings",
    },
  ]);
});

Deno.test("an unscoped credential remains installation-wide", () => {
  const model = buildCanonicalConnectorReadModel(rows);
  assertEquals(model[1].credentials[0].scope, { kind: "installation" });
});

Deno.test("a credential never resolves an account through another installation", () => {
  const model = buildCanonicalConnectorReadModel({
    ...rows,
    credentials: [{
      ...rows.credentials[2],
      account_id: "account-current",
    }],
  });

  assertEquals(model[1].credentials[0].scope, {
    kind: "unresolved_account",
    accountId: "account-current",
  });
});

Deno.test("orphan canonical rows are excluded instead of being guessed into an installation", () => {
  const model = buildCanonicalConnectorReadModel({
    ...rows,
    sources: [
      ...rows.sources,
      {
        ...rows.sources[0],
        id: "orphan-source",
        connector_installation_id: "unknown-installation",
      },
    ],
    accounts: [
      ...rows.accounts,
      {
        ...rows.accounts[0],
        id: "orphan-account",
        financial_source_id: "orphan-source",
      },
    ],
  });

  assertEquals(
    model.flatMap((installation) => installation.sources).length,
    3,
  );
  assertEquals(
    model.flatMap((installation) => installation.sources)
      .flatMap((source) => source.accounts).length,
    3,
  );
});
