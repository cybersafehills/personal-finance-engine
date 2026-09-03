// The cloud-storage destination contract. Pure - types + provider
// metadata only; the registry that reads env and builds clients is
// server-only (./registry.ts). Every provider is DARK until its
// *_CLIENT_ID / *_SECRET env is set; clients built without config throw
// `provider_not_configured` from every method.

export const CLOUD_STORAGE_PROVIDERS = [
  "google_drive",
  "onedrive",
  "dropbox",
] as const;
export type CloudStorageProviderKey = (typeof CLOUD_STORAGE_PROVIDERS)[number];

export type CloudStorageProviderMeta = {
  key: CloudStorageProviderKey;
  label: string;
  authUrl: string;
  tokenUrl: string;
  scopes: string[];
  usesPkce: boolean;
  /** names of the env vars that must be set for this provider to work */
  clientIdEnv: string;
  clientSecretEnv: string;
};

export const CLOUD_STORAGE_PROVIDER_META: Record<
  CloudStorageProviderKey,
  CloudStorageProviderMeta
> = {
  google_drive: {
    key: "google_drive",
    label: "Google Drive",
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: ["https://www.googleapis.com/auth/drive.file"],
    usesPkce: true,
    clientIdEnv: "GOOGLE_DRIVE_CLIENT_ID",
    clientSecretEnv: "GOOGLE_DRIVE_CLIENT_SECRET",
  },
  onedrive: {
    key: "onedrive",
    label: "OneDrive",
    authUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scopes: ["Files.ReadWrite", "offline_access"],
    usesPkce: true,
    clientIdEnv: "MICROSOFT_CLIENT_ID",
    clientSecretEnv: "MICROSOFT_CLIENT_SECRET",
  },
  dropbox: {
    key: "dropbox",
    label: "Dropbox",
    authUrl: "https://www.dropbox.com/oauth2/authorize",
    tokenUrl: "https://api.dropboxapi.com/oauth2/token",
    scopes: ["files.content.write"],
    usesPkce: true,
    clientIdEnv: "DROPBOX_APP_KEY",
    clientSecretEnv: "DROPBOX_APP_SECRET",
  },
};

export function isCloudStorageProviderKey(
  value: string,
): value is CloudStorageProviderKey {
  return (CLOUD_STORAGE_PROVIDERS as readonly string[]).includes(value);
}

/** Normalise a user-typed folder path: leading slash, no trailing slash,
 *  no `..`, collapsed separators. Returns null when it can't be made safe. */
export function normalizeFolderPath(raw: string): string | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "/";
  if (trimmed.includes("..")) return null;
  const parts = trimmed
    .split("/")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.some((p) => /[\\:*?"<>|]/.test(p))) return null;
  if (parts.join("/").length > 400) return null;
  return "/" + parts.join("/");
}

export type OAuthTokenSet = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null; // ISO
  scope: string | null;
};

export type CloudUploadInput = {
  folderPath: string;
  filename: string;
  contentType: string;
  body: Uint8Array;
};

export type CloudFolder = { id: string; name: string; path: string };

export type CloudStorageClient = {
  provider: CloudStorageProviderKey;
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
  listFolders(token: OAuthTokenSet, parentPath: string): Promise<CloudFolder[]>;
  uploadFile(token: OAuthTokenSet, input: CloudUploadInput): Promise<{ id: string }>;
};

export class ProviderNotConfiguredError extends Error {
  code = "provider_not_configured";
  constructor(public providerKey: string) {
    super(`Cloud provider "${providerKey}" is not configured on this deployment.`);
    this.name = "ProviderNotConfiguredError";
  }
}
