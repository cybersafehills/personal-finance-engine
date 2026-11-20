import { Card, DataTable, EmptyState, ErrorState, KpiCard, PageHeader, StatusPill, Unavailable, type Tone } from "../../../../components/ui/primitives";
import { consoleRpc, requireSession } from "../../../../lib/console/access";
import { formatCount, humanizeAction } from "../../../../lib/format";

export const metadata = { title: "Integrations" };

type Res = {
  ingestion_connections: { provider: string; status: string; count: number }[];
  connector_installations: { connector: string; status: string; count: number }[];
  sync_runs_24h: { status: string; count: number }[];
  webhook_deliveries_24h: { status: string; count: number }[];
  webhook_subscriptions: number;
};
const TONE: Record<string, Tone> = { active: "positive", healthy: "positive", succeeded: "positive", delivered: "positive", success: "positive", error: "danger", failed: "danger", revoked: "neutral", paused: "neutral", stale: "attention", pending: "attention", queued: "attention", running: "info", setup: "info", testing: "info" };
const sum = (rows: { status: string; count: number }[], pick?: (s: string) => boolean) => rows.reduce((a, r) => a + (!pick || pick(r.status) ? r.count : 0), 0);

export default async function IntegrationsPage() {
  const session = await requireSession();
  const res = await consoleRpc<Res>(session, "console_integrations_overview");
  if (!res.ok) return (<><PageHeader title="Integrations" /><ErrorState message="The integrations overview could not be loaded." /></>);
  const d = res.data;
  const failedSync = sum(d.sync_runs_24h, (s) => s === "failed");
  const failedHooks = sum(d.webhook_deliveries_24h, (s) => s === "failed");
  return (
    <>
      <PageHeader title="Integrations" subtitle="How customers' connections, connectors, syncs and webhooks are doing. Counts only; no endpoints, credentials or customer data are shown." />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Active connections" value={formatCount(sum(d.ingestion_connections, (s) => s === "active"))} hint={`${formatCount(sum(d.ingestion_connections))} in total`} />
        <KpiCard label="Connector installations" value={formatCount(sum(d.connector_installations))} />
        <KpiCard label="Failed syncs (24 h)" value={formatCount(failedSync)} tone={failedSync > 0 ? "attention" : undefined} hint={`${formatCount(sum(d.sync_runs_24h))} runs`} />
        <KpiCard label="Failed webhooks (24 h)" value={formatCount(failedHooks)} tone={failedHooks > 0 ? "attention" : undefined} hint={`${formatCount(d.webhook_subscriptions)} subscriptions`} />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Ingestion connections" subtitle="By provider and status" padded={false}>
          {d.ingestion_connections.length === 0 ? <EmptyState message="No connections yet." /> : (
            <div className="p-1"><DataTable caption="Ingestion connections" columns={["Provider", "Status", "Count"]}>
              {d.ingestion_connections.map((r, i) => (<tr key={i}><td className="px-3 py-2.5">{humanizeAction(r.provider)}</td><td className="px-3 py-2.5"><StatusPill tone={TONE[r.status] ?? "neutral"}>{r.status}</StatusPill></td><td className="px-3 py-2.5 tabular-nums">{r.count}</td></tr>))}
            </DataTable></div>
          )}
        </Card>
        <Card title="Connector installations" subtitle="By connector and status" padded={false}>
          {d.connector_installations.length === 0 ? <EmptyState message="No connector installations yet." /> : (
            <div className="p-1"><DataTable caption="Connector installations" columns={["Connector", "Status", "Count"]}>
              {d.connector_installations.map((r, i) => (<tr key={i}><td className="px-3 py-2.5">{humanizeAction(r.connector)}</td><td className="px-3 py-2.5"><StatusPill tone={TONE[r.status] ?? "neutral"}>{r.status}</StatusPill></td><td className="px-3 py-2.5 tabular-nums">{r.count}</td></tr>))}
            </DataTable></div>
          )}
        </Card>
        <Card title="Sync runs (24 h)" padded={false}>
          {d.sync_runs_24h.length === 0 ? <EmptyState message="No sync runs in the last 24 hours." hint="Syncs are not enabled for most workspaces yet." /> : (
            <div className="p-1"><DataTable caption="Sync runs" columns={["Status", "Count"]}>
              {d.sync_runs_24h.map((r, i) => (<tr key={i}><td className="px-3 py-2.5"><StatusPill tone={TONE[r.status] ?? "neutral"}>{r.status}</StatusPill></td><td className="px-3 py-2.5 tabular-nums">{r.count}</td></tr>))}
            </DataTable></div>
          )}
        </Card>
        <Card title="Webhook deliveries (24 h)" padded={false}>
          {d.webhook_deliveries_24h.length === 0 ? <EmptyState message="No webhook deliveries in the last 24 hours." /> : (
            <div className="p-1"><DataTable caption="Webhook deliveries" columns={["Status", "Count"]}>
              {d.webhook_deliveries_24h.map((r, i) => (<tr key={i}><td className="px-3 py-2.5"><StatusPill tone={TONE[r.status] ?? "neutral"}>{r.status}</StatusPill></td><td className="px-3 py-2.5 tabular-nums">{r.count}</td></tr>))}
            </DataTable></div>
          )}
        </Card>
      </div>
      <div className="mt-4"><Unavailable title="Platform vendors not monitored here" reason="Status of Supabase, Vercel, Resend and payment providers has no telemetry feed into the console, so it is not shown rather than guessed." /></div>
    </>
  );
}
