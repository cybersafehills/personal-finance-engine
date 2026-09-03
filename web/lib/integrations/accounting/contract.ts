// The accounting-connector contract. Pure - types + provider metadata
// only; the registry that reads env and builds adapters is server-only
// (./registry.ts). Every provider is DARK until its *_CLIENT_ID /
// *_SECRET env is set; adapters built without config throw
// `provider_not_configured` from every method. Even a configured adapter
// leaves pushEntries / listAccounts unimplemented for now - a sync run
// records a `partial` outcome, never a fake success.

export const ACCOUNTING_PROVIDERS = [
  "quickbooks",
  "xero",
  "zoho_books",
  "odoo",
] as const;
export type AccountingProviderKey = (typeof ACCOUNTING_PROVIDERS)[number];

export type AccountingProviderMeta = {
  key: AccountingProviderKey;
  label: string;
  authUrl: string;
  tokenUrl: string;
  scopes: string[];
  usesPkce: boolean;
  /** names of the env vars that must be set for this provider to work */
  clientIdEnv: string;
  clientSecretEnv: string;
};

export const ACCOUNTING_PROVIDER_META: Record<
  AccountingProviderKey,
  AccountingProviderMeta
> = {
  quickbooks: {
    key: "quickbooks",
    label: "QuickBooks Online",
    authUrl: "https://appcenter.intuit.com/connect/oauth2",
    tokenUrl: "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
    scopes: ["com.intuit.quickbooks.accounting"],
    usesPkce: false,
    clientIdEnv: "QUICKBOOKS_CLIENT_ID",
    clientSecretEnv: "QUICKBOOKS_CLIENT_SECRET",
  },
  xero: {
    key: "xero",
    label: "Xero",
    authUrl: "https://login.xero.com/identity/connect/authorize",
    tokenUrl: "https://identity.xero.com/connect/token",
    scopes: [
      "offline_access",
      "accounting.transactions",
      "accounting.settings",
    ],
    usesPkce: true,
    clientIdEnv: "XERO_CLIENT_ID",
    clientSecretEnv: "XERO_CLIENT_SECRET",
  },
  zoho_books: {
    key: "zoho_books",
    label: "Zoho Books",
    authUrl: "https://accounts.zoho.com/oauth/v2/auth",
    tokenUrl: "https://accounts.zoho.com/oauth/v2/token",
    scopes: ["ZohoBooks.fullaccess.all"],
    usesPkce: false,
    clientIdEnv: "ZOHO_BOOKS_CLIENT_ID",
    clientSecretEnv: "ZOHO_BOOKS_CLIENT_SECRET",
  },
  odoo: {
    key: "odoo",
    label: "Odoo",
    authUrl: "https://accounts.odoo.com/oauth2/auth",
    tokenUrl: "https://accounts.odoo.com/oauth2/token",
    scopes: ["accounting"],
    usesPkce: true,
    clientIdEnv: "ODOO_CLIENT_ID",
    clientSecretEnv: "ODOO_CLIENT_SECRET",
  },
};

export function isAccountingProviderKey(
  value: string,
): value is AccountingProviderKey {
  return (ACCOUNTING_PROVIDERS as readonly string[]).includes(value);
}

/**
 * True for a recognised accounting provider key. Every one is OAuth-gated
 * and dark until configured - there is no "manual file" equivalent as
 * there is for workbooks - so this is currently the same as
 * isAccountingProviderKey, kept as a distinct name for the connector
 * how-to contract and for a future non-OAuth provider.
 */
export function isRealAccountingProvider(key: string): boolean {
  return isAccountingProviderKey(key);
}

export type OAuthTokenSet = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null; // ISO
  scope: string | null;
};

/** An external chart-of-accounts entry the user maps OneLedger keys to. */
export type LedgerAccountRef = {
  id: string;
  name: string;
  type?: string;
};

/**
 * OneLedger category / account key -> external account id. Keys look like
 * `category:Meals` or `account:<uuid>`; values are opaque provider ids.
 */
export type AccountMap = Record<string, string>;

/** One ledger row to push to the external books. */
export type AccountingEntry = {
  date: string; // ISO
  description: string;
  /** signed minor units: money out is negative. */
  amountMinor: number;
  currency: string;
  /** the OneLedger key used to look up the external account in AccountMap. */
  oneledgerKey: string;
  /** OneLedger transaction id, for idempotency on the provider side. */
  externalTxnId: string;
};

export type PushEntriesInput = {
  externalRef: string | null;
  accountMap: AccountMap;
  entries: AccountingEntry[];
};

export type AccountingAdapter = {
  provider: AccountingProviderKey;
  /** URL to send the user to for consent. */
  authUrl(params: {
    redirectUri: string;
    state: string;
    codeChallenge?: string;
  }): string;
  exchangeCode(params: {
    code: string;
    redirectUri: string;
    codeVerifier?: string;
  }): Promise<OAuthTokenSet>;
  refresh(refreshToken: string): Promise<OAuthTokenSet>;
  listAccounts(token: OAuthTokenSet, externalRef: string | null): Promise<
    LedgerAccountRef[]
  >;
  pushEntries(
    token: OAuthTokenSet,
    input: PushEntriesInput,
  ): Promise<{ pushed: number; skipped: number }>;
  getRevision(
    token: OAuthTokenSet,
    externalRef: string | null,
  ): Promise<string | null>;
};

const MAX_ACCOUNT_MAP_ENTRIES = 500;

/**
 * Coerce arbitrary input to a safe AccountMap: string->string only,
 * trimmed, non-empty, bounded. Unknown shapes become an empty map.
 */
export function normalizeAccountMap(raw: unknown): AccountMap {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: AccountMap = {};
  let n = 0;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (n >= MAX_ACCOUNT_MAP_ENTRIES) break;
    if (typeof value !== "string") continue;
    const k = key.trim();
    const v = value.trim();
    if (!k || !v || k.length > 200 || v.length > 200) continue;
    out[k] = v;
    n += 1;
  }
  return out;
}

export class AccountingProviderNotConfiguredError extends Error {
  code = "provider_not_configured";
  constructor(public providerKey: string) {
    super(
      `Accounting provider "${providerKey}" is not configured on this deployment.`,
    );
    this.name = "AccountingProviderNotConfiguredError";
  }
}
