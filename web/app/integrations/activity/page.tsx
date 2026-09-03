import Link from "next/link";
import { PageHeader } from "../../../components/PageHeader";
import { EmptyState } from "../../../components/EmptyState";
import { Badge } from "../../../components/Badge";
import { formatDateTime } from "../../../lib/format";
import { getActiveWorkspaceId } from "../../../lib/queries";
import { isIntegrationsEnabled } from "../../../lib/integrations/gate";
import { getIntegrationActivity } from "../../../lib/integrations/activity";

export const dynamic = "force-dynamic";

export default async function IntegrationsActivityPage() {
  const workspaceId = await getActiveWorkspaceId();

  if (!isIntegrationsEnabled(workspaceId)) {
    return (
      <div>
        <PageHeader title="Integration activity" backHref="/integrations" backLabel="Integrations" />
        <EmptyState title="Integrations isn’t enabled for this Space" />
      </div>
    );
  }

  const activity = await getIntegrationActivity(100);

  return (
    <div>
      <PageHeader
        title="Integration activity"
        subtitle="Imports, exports, and connection events — most recent first."
        backHref="/integrations"
        backLabel="Integrations"
      />

      {activity.total === 0 ? (
        <EmptyState
          title="Nothing to show yet"
          description="Import a file or connect a service and its activity will appear here."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {activity.items.map((item) => {
            const inner = (
              <>
                <span className="min-w-0">
                  <span className="block text-sm text-text-primary">
                    {item.summary}
                  </span>
                  <span className="block text-xs text-text-muted">
                    {item.kind} · {formatDateTime(item.at)}
                  </span>
                </span>
                {item.severity !== "info" && (
                  <Badge
                    variant={item.severity === "error" ? "attention" : "neutral"}
                  >
                    {item.severity === "error" ? "Error" : "Warning"}
                  </Badge>
                )}
              </>
            );
            return (
              <li
                key={item.id}
                className="flex items-center justify-between gap-3 rounded-card border border-border-subtle bg-surface p-4"
              >
                {item.href ? (
                  <Link
                    href={item.href}
                    className="flex flex-1 items-center justify-between gap-3"
                  >
                    {inner}
                  </Link>
                ) : (
                  inner
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
