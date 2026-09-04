import { PageHeader } from "../../../components/PageHeader";
import { EmptyState } from "../../../components/EmptyState";
import { ApiKeyManager } from "../../../components/ApiKeyManager";
import { WebhookManager } from "../../../components/WebhookManager";
import { getActiveWorkspaceId } from "../../../lib/queries";
import { supabaseServer } from "../../../lib/supabase-server";
import {
  isDeveloperApiEnabled,
  isDeveloperWebhooksEnabled,
} from "../../../lib/integrations/gate";
import { listApiKeys } from "../../../lib/integrations/queries";
import {
  getRecentWebhookDeliveries,
  listWebhookSubscriptions,
} from "../../../lib/integrations/webhooks/queries";

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

  const webhooksEnabled = isDeveloperWebhooksEnabled(workspaceId);
  const [keys, subscriptions, deliveries] = await Promise.all([
    listApiKeys(),
    webhooksEnabled ? listWebhookSubscriptions() : Promise.resolve([]),
    webhooksEnabled && workspaceId
      ? getRecentWebhookDeliveries(supabaseServer(), workspaceId, 20)
      : Promise.resolve([]),
  ]);

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

      {webhooksEnabled && (
        <section className="mt-8">
          <h2 className="mb-1 text-sm font-semibold text-text-primary">Webhooks</h2>
          <p className="mb-3 text-sm text-text-muted">
            OneLedger POSTs a signed JSON envelope to your endpoint when an event
            happens. Signature verification and the event catalog are in{" "}
            <code className="text-text-secondary">docs/integrations-webhooks.md</code>.
          </p>
          <WebhookManager
            subscriptions={subscriptions}
            deliveries={deliveries}
          />
        </section>
      )}
    </div>
  );
}
