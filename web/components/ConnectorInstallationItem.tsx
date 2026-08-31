import { Badge } from "./Badge";
import { formatDateTime } from "../lib/format";
import type {
  CanonicalConnectorInstallation,
  CanonicalCredentialScope,
} from "../lib/connector-read-model";
import { safeConnectorErrorCode } from "../lib/connector-ui-mode";

const CONNECTOR_LABELS: Record<string, string> = {
  mtn_momo_sms_v1: "MTN MoMo SMS",
  airtel_money_sms_v1: "Airtel Money SMS",
  bank_open_api_v1: "Bank connection",
  statement_csv_v1: "Statement import",
};

function installationStatus(
  status: CanonicalConnectorInstallation["status"],
): { label: string; variant: "positive" | "neutral" | "attention" } {
  switch (status) {
    case "healthy":
      return { label: "Healthy", variant: "positive" };
    case "setup":
      return { label: "Setup needed", variant: "neutral" };
    case "testing":
      return { label: "Testing", variant: "neutral" };
    case "stale":
      return { label: "Stale", variant: "attention" };
    case "paused":
      return { label: "Paused", variant: "neutral" };
    case "error":
      return { label: "Needs attention", variant: "attention" };
    case "revoked":
      return { label: "Revoked", variant: "attention" };
  }
}

function credentialScopeLabel(scope: CanonicalCredentialScope): string {
  switch (scope.kind) {
    case "installation":
      return "All discovered accounts";
    case "account":
      return scope.accountName;
    case "unresolved_account":
      return "Account scope unavailable";
  }
}

function sourceDescriptor(
  source: CanonicalConnectorInstallation["sources"][number],
): string {
  return [source.maskedIdentifier, source.currency].filter(Boolean).join(" · ");
}

export function ConnectorInstallationItem({
  installation,
}: {
  installation: CanonicalConnectorInstallation;
}) {
  const status = installationStatus(installation.status);
  const errorCode = safeConnectorErrorCode(installation.lastErrorCode);

  return (
    <article className="flex flex-col gap-4 rounded-card border border-border-subtle bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-medium text-text-primary">
              {installation.displayName}
            </h2>
            <Badge variant={status.variant}>{status.label}</Badge>
          </div>
          <p className="mt-1 text-xs text-text-muted">
            {CONNECTOR_LABELS[installation.connectorKey] ??
              installation.connectorKey.replaceAll("_", " ")}
          </p>
        </div>

        <div className="text-right text-xs text-text-muted">
          {installation.lastSuccessAt
            ? `Last successful sync ${formatDateTime(installation.lastSuccessAt)}`
            : "No successful sync yet"}
        </div>
      </div>

      {installation.status === "error" && (
        <p className="rounded-control bg-background p-3 text-xs text-attention">
          Connector health requires attention.
          {errorCode ? ` Reference: ${errorCode}` : ""}
        </p>
      )}

      <section aria-labelledby={`sources-${installation.id}`}>
        <div className="mb-2 flex items-center justify-between gap-3">
          <h3
            id={`sources-${installation.id}`}
            className="text-xs font-semibold uppercase tracking-wide text-text-muted"
          >
            Financial sources
          </h3>
          <span className="text-xs text-text-muted">
            {installation.sources.length}
          </span>
        </div>

        {installation.sources.length === 0 ? (
          <p className="rounded-control bg-background p-3 text-xs text-text-muted">
            No financial sources discovered yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {installation.sources.map((source) => (
              <li
                key={source.id}
                className="rounded-control border border-border-subtle bg-background p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-text-primary">
                      {source.displayName}
                    </p>
                    <p className="text-xs text-text-muted">
                      {sourceDescriptor(source)}
                    </p>
                  </div>
                  <Badge variant={source.status === "active" ? "positive" : "neutral"}>
                    {source.status}
                  </Badge>
                </div>

                <div className="mt-3 border-t border-border-subtle pt-2">
                  <p className="text-xs font-medium text-text-secondary">
                    Accounts
                  </p>
                  {source.accounts.length === 0 ? (
                    <p className="mt-1 text-xs text-text-muted">
                      No ledger account is linked yet.
                    </p>
                  ) : (
                    <ul className="mt-1 flex flex-wrap gap-2">
                      {source.accounts.map((account) => (
                        <li
                          key={account.id}
                          className="rounded-full border border-border-subtle bg-surface px-2.5 py-1 text-xs text-text-secondary"
                        >
                          {account.name} · {account.currency}
                          {!account.isActive ? " · Archived" : ""}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby={`credentials-${installation.id}`}>
        <div className="mb-2 flex items-center justify-between gap-3">
          <h3
            id={`credentials-${installation.id}`}
            className="text-xs font-semibold uppercase tracking-wide text-text-muted"
          >
            Device credentials
          </h3>
          <span className="text-xs text-text-muted">
            {installation.credentials.length}
          </span>
        </div>

        {installation.credentials.length === 0 ? (
          <p className="rounded-control bg-background p-3 text-xs text-text-muted">
            No device credentials enrolled.
          </p>
        ) : (
          <ul className="divide-y divide-border-subtle rounded-control border border-border-subtle bg-background">
            {installation.credentials.map((credential) => (
              <li
                key={credential.id}
                className="flex flex-wrap items-center justify-between gap-3 p-3"
              >
                <div>
                  <p className="text-sm font-medium text-text-primary">
                    {credential.label}
                  </p>
                  <p className="text-xs text-text-muted">
                    <code>{credential.credentialPrefix}…</code>
                    {" · "}
                    {credentialScopeLabel(credential.scope)}
                  </p>
                </div>
                <div className="text-right">
                  <Badge
                    variant={credential.status === "active" ? "positive" : "neutral"}
                  >
                    {credential.status}
                  </Badge>
                  <p className="mt-1 text-xs text-text-muted">
                    {credential.lastUsedAt
                      ? `Last used ${formatDateTime(credential.lastUsedAt)}`
                      : "Never used"}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </article>
  );
}
