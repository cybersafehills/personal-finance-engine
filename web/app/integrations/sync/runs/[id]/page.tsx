import { notFound } from "next/navigation";
import { PageHeader } from "../../../../../components/PageHeader";
import { Badge } from "../../../../../components/Badge";
import { formatDateTime } from "../../../../../lib/format";
import { getActiveWorkspaceId } from "../../../../../lib/queries";
import { isSyncEnabled } from "../../../../../lib/integrations/gate";
import { getSyncRun } from "../../../../../lib/integrations/queries";

export const dynamic = "force-dynamic";

export default async function SyncRunPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const workspaceId = await getActiveWorkspaceId();
  if (!isSyncEnabled(workspaceId)) notFound();

  const run = await getSyncRun(id);
  if (!run) notFound();

  const rows: [string, string][] = [
    ["Trigger", run.trigger],
    ["Direction", run.direction],
    ["Started", run.startedAt ? formatDateTime(run.startedAt) : "—"],
    ["Finished", run.finishedAt ? formatDateTime(run.finishedAt) : "—"],
    ["Attempt", String(run.attempt)],
    ["Cursor before", run.cursorBefore ?? "—"],
    ["Cursor after", run.cursorAfter ?? "—"],
  ];

  return (
    <div>
      <PageHeader
        title="Sync run"
        subtitle={formatDateTime(run.createdAt)}
        backHref="/integrations/sync"
        backLabel="Sync & Automation"
        action={
          <Badge
            variant={run.status === "succeeded"
              ? "positive"
              : run.status === "failed"
              ? "attention"
              : "neutral"}
          >
            {run.status}
          </Badge>
        }
      />

      <dl className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {rows.map(([k, v]) => (
          <div key={k} className="rounded-card border border-border-subtle bg-surface px-3 py-2.5">
            <dt className="text-xs text-text-muted">{k}</dt>
            <dd className="mt-0.5 text-sm font-medium text-text-primary">{v}</dd>
          </div>
        ))}
      </dl>

      {Object.keys(run.counts).length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-semibold text-text-primary">Counts</h2>
          <ul className="flex flex-wrap gap-2 text-sm">
            {Object.entries(run.counts).map(([k, v]) => (
              <li key={k} className="rounded-control border border-border-subtle bg-surface px-3 py-1.5 text-text-secondary">
                {k}: <span className="font-medium text-text-primary">{v}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {run.error && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-text-primary">Error</h2>
          <pre className="overflow-x-auto rounded-card border border-border-subtle bg-surface p-3 text-xs text-text-secondary">
            {JSON.stringify(run.error, null, 2)}
          </pre>
        </section>
      )}
    </div>
  );
}
