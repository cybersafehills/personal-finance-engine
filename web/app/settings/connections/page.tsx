import { getAccounts, getIngestionConnections } from "../../../lib/queries";
import { PageHeader } from "../../../components/PageHeader";
import { EmptyState } from "../../../components/EmptyState";
import { ConnectionItem } from "../../../components/ConnectionItem";
import { CreateConnectionForm } from "../../../components/CreateConnectionForm";

export const dynamic = "force-dynamic";

export default async function ConnectionsPage() {
  const [connections, accounts] = await Promise.all([
    getIngestionConnections(),
    getAccounts(),
  ]);
  const activeAccounts = accounts.filter((account) => account.is_active);

  return (
    <div>
      <PageHeader
        title="Connections"
        subtitle="The devices and Shortcuts that send transactions in"
      />

      <div className="flex flex-col gap-3">
        {connections.length === 0 ? (
          <EmptyState
            title="No connections yet"
            description="Connect a device to start sending transactions automatically."
          />
        ) : (
          connections.map((connection) => (
            <ConnectionItem key={connection.id} connection={connection} />
          ))
        )}

        <CreateConnectionForm accounts={activeAccounts} />
      </div>
    </div>
  );
}
