import { PageHeader } from "../../../components/PageHeader";
import { EmptyState } from "../../../components/EmptyState";
import { ApiKeyManager } from "../../../components/ApiKeyManager";
import { getActiveWorkspaceId } from "../../../lib/queries";
import { isDeveloperApiEnabled } from "../../../lib/integrations/gate";
import { listApiKeys } from "../../../lib/integrations/queries";

export const dynamic = "force-dynamic";

export default async function DeveloperPage() {
  const workspaceId = await getActiveWorkspaceId();

  if (!isDeveloperApiEnabled(workspaceId)) {
    return (
      <div>
        <PageHeader
          title="Developer API"
          backHref="/integrations"
          backLabel="Integrations"
        />
        <EmptyState title="The developer API isn’t enabled for this Space" />
      </div>
    );
  }

  const keys = await listApiKeys();

  return (
    <div>
      <PageHeader
        title="Developer API"
        subtitle="Read-only REST access to this Space. Keys are scoped, rate-limited, and shown once."
        backHref="/integrations"
        backLabel="Integrations"
      />

      <div className="mb-6 rounded-card border border-border-subtle bg-surface p-4 text-sm text-text-muted">
        Base URL <code className="text-text-secondary">/api/v1</code>. Send your
        key as <code className="text-text-secondary">Authorization: Bearer olk_…</code>.
        See <code className="text-text-secondary">docs/integrations-developer-api.md</code>{" "}
        for the endpoint reference.
      </div>

      <h2 className="mb-2 text-sm font-semibold text-text-primary">API keys</h2>
      <ApiKeyManager keys={keys} />
    </div>
  );
}
