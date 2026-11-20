import { ColumnChart } from "../../../../components/ui/charts";
import { Card, DataTable, EmptyState, ErrorState, KpiCard, PageHeader, Unavailable } from "../../../../components/ui/primitives";
import { consoleRpc, requireSession } from "../../../../lib/console/access";
import { formatCount, humanizeAction } from "../../../../lib/format";

export const metadata = { title: "Communications" };

type Email = { attempted: number; sent: number; skipped: number; failed: number; pending_outbox: number; oldest_pending_age_seconds: number };
type Res = { notifications_7d: { channel: string; created: number; delivered: number }[]; notifications_by_day: { day: string; count: number }[]; email_health: Email | null };

export default async function CommunicationsPage() {
  const session = await requireSession();
  const res = await consoleRpc<Res>(session, "console_communications_overview");
  if (!res.ok) return (<><PageHeader title="Communications" /><ErrorState message="The communications overview could not be loaded." /></>);
  const d = res.data;
  const e = d.email_health;
  const total = d.notifications_by_day.reduce((a, b) => a + b.count, 0);
  return (
    <>
      <PageHeader title="Communications" subtitle="Delivery of the messages OneLedger sends to customers. Counts only: no recipients, subjects or message text are shown. Bulk or promotional messaging is not available here." />
      {e ? (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard label="Emails attempted (24 h)" value={formatCount(e.attempted)} hint={`${formatCount(e.sent)} sent`} />
          <KpiCard label="Failed or skipped" value={formatCount(e.failed + e.skipped)} tone={e.failed > 0 ? "attention" : undefined} hint={`${formatCount(e.failed)} failed · ${formatCount(e.skipped)} skipped`} />
          <KpiCard label="Waiting to send" value={formatCount(e.pending_outbox)} hint={e.pending_outbox > 0 ? `oldest ${Math.round(e.oldest_pending_age_seconds / 60)} min` : "Queue is empty"} />
          <KpiCard label="Notifications (14 d)" value={formatCount(total)} />
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card title="Notifications per day" subtitle="Last 14 days (Kigali time)">
          {d.notifications_by_day.length === 0 ? <EmptyState message="No notifications in the last 14 days." /> : (
            <ColumnChart points={d.notifications_by_day.map((x) => ({ label: x.day, value: x.count }))} summary={`Notifications per day over 14 days, ${total} in total.`} />
          )}
        </Card>
        <Card title="By channel (7 days)" padded={false}>
          {d.notifications_7d.length === 0 ? <EmptyState message="No notifications in the last 7 days." /> : (
            <div className="p-1"><DataTable caption="Notifications by channel" columns={["Channel", "Created", "Delivered"]}>
              {d.notifications_7d.map((r) => (<tr key={r.channel}><td className="px-3 py-2.5">{humanizeAction(r.channel)}</td><td className="px-3 py-2.5 tabular-nums">{r.created}</td><td className="px-3 py-2.5 tabular-nums">{r.delivered}</td></tr>))}
            </DataTable></div>
          )}
        </Card>
      </div>
      <div className="mt-4"><Unavailable title="Provider-level delivery (bounces, complaints)" reason="Resend's own delivery events are not fed into the console, so bounce and complaint rates are not shown." /></div>
    </>
  );
}
