import Link from "next/link";
import {
  getAccounts,
  getCanonicalConnectorInstallations,
  getCanonicalConnectionsReadCutoverStatus,
  getIngestionConnections,
} from "../../../lib/queries";
import { buildIngestEndpointUrl } from "../../../lib/ingest";
import { PageHeader } from "../../../components/PageHeader";
import { EmptyState } from "../../../components/EmptyState";
import { ConnectionItem } from "../../../components/ConnectionItem";
import { CreateConnectionForm } from "../../../components/CreateConnectionForm";
import { ConnectorInstallationItem } from "../../../components/ConnectorInstallationItem";
import { canonicalConnectionsUiEnabled } from "../../../lib/connector-ui-mode";
import { isPlatformAdmin } from "../../../lib/pay/admin";

export const dynamic = "force-dynamic";

export default async function ConnectionsPage() {
  // Server-only, default-off Stage D cutover request. The database readiness
  // check is a second, per-user gate: any missing or unreadable canonical
  // mapping automatically falls back to the complete legacy projection.
  const canonicalCutoverRequested = canonicalConnectionsUiEnabled(
    process.env.ONELEDGER_CANONICAL_CONNECTIONS_UI,
  );
  const cutoverStatus = canonicalCutoverRequested
    ? await getCanonicalConnectionsReadCutoverStatus()
    : null;
  const canonicalPreviewEnabled = canonicalCutoverRequested &&
    cutoverStatus?.ready === true;
  const [
    connections,
    canonicalInstallations,
    accounts,
    canManageAdapterCanary,
  ] = await Promise.all([
    canonicalPreviewEnabled
      ? Promise.resolve([])
      : getIngestionConnections(),
    canonicalPreviewEnabled
      ? getCanonicalConnectorInstallations()
      : Promise.resolve([]),
    getAccounts(),
    isPlatformAdmin(),
  ]);
  const activeAccounts = accounts.filter((account) => account.is_active);

  // Resolved once, server-side, from the same host the Supabase client
  // already uses - the components never touch env directly. SUPABASE_URL
  // is the always-present server var; NEXT_PUBLIC_SUPABASE_URL is only a
  // fallback for setups that set that one instead.
  const ingestEndpointUrl = buildIngestEndpointUrl(
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL,
  );

  return (
    <div>
      <PageHeader
        title="Connections"
        subtitle="The devices and Shortcuts that send transactions in"
      />

      <p className="mb-3 text-sm text-text-secondary">
        New here?{" "}
        <Link
          href="/settings/connections/setup"
          className="font-medium text-accent hover:underline"
        >
          Set up a device with an iPhone Shortcut
        </Link>
        .
      </p>

      <div className="flex flex-col gap-3">
        {canonicalPreviewEnabled ? (
          canonicalInstallations.length === 0 ? (
            <EmptyState
              title="No connector installations yet"
              description="Connect a device or provider to start discovering financial sources."
            />
          ) : (
            canonicalInstallations.map((installation) => (
              <ConnectorInstallationItem
                key={installation.id}
                installation={installation}
                canManageAdapterCanary={canManageAdapterCanary}
                ingestEndpointUrl={ingestEndpointUrl}
              />
            ))
          )
        ) : (
          connections.length === 0 ? (
            <EmptyState
              title="No connections yet"
              description="Connect a device to start sending transactions automatically."
            />
          ) : (
            connections.map((connection) => (
              <ConnectionItem
                key={connection.id}
                connection={connection}
                ingestEndpointUrl={ingestEndpointUrl}
                canManageAdapterCanary={canManageAdapterCanary}
              />
            ))
          )
        )}

        <CreateConnectionForm
          accounts={activeAccounts}
          ingestEndpointUrl={ingestEndpointUrl}
        />
      </div>
    </div>
  );
}
