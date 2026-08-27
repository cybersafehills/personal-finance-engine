import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "../../../../components/PageHeader";
import { Badge } from "../../../../components/Badge";
import { SuggestionModerationPanel } from "../../../../components/directory/SuggestionModerationPanel";
import { getDirectoryAccess } from "../../../../lib/pay/directory-perms";
import {
  listDirectorySuggestions,
  getOpenReportAggregates,
} from "../../../../lib/directory/suggestions";

export const dynamic = "force-dynamic";

export default async function DirectorySuggestionsPage() {
  const access = await getDirectoryAccess();
  if (!access.canViewAdmin) notFound();

  const [{ open, resolved }, reportAgg] = await Promise.all([
    listDirectorySuggestions(),
    getOpenReportAggregates(),
  ]);

  const canResolve = access.has("directory.resolve_reports");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Suggestions & Reports"
        subtitle="User submissions — nothing here is published without verification"
        backHref="/admin/directory"
        backLabel="Directory Management"
      />

      <section>
        <h2 className="mb-2 text-sm font-semibold text-text-secondary">
          Entries with multiple open reports
        </h2>
        {reportAgg.filter((r) => r.openCount > 1).length === 0 ? (
          <p className="text-sm text-text-muted">None right now.</p>
        ) : (
          <ul className="text-sm">
            {reportAgg
              .filter((r) => r.openCount > 1)
              .map((r) => (
                <li
                  key={`${r.targetType}:${r.targetId}`}
                  className="flex items-center justify-between gap-3 border-b border-border-subtle py-2 last:border-b-0"
                >
                  <span>
                    {r.targetLabel}{" "}
                    <span className="text-xs text-text-muted">({r.targetType.replace("_", " ")})</span>
                  </span>
                  <Badge variant="attention">{r.openCount} open reports</Badge>
                </li>
              ))}
          </ul>
        )}
        <p className="mt-1 text-xs text-text-muted">
          Report count is a visibility signal, not verification. Triage individual reports from{" "}
          <Link href="/admin/ussd" className="text-accent">
            USSD Codes
          </Link>{" "}
          or the relevant route.
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-text-secondary">
          Open suggestions ({open.length})
        </h2>
        <SuggestionModerationPanel suggestions={open} canResolve={canResolve} />
      </section>

      {resolved.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-text-secondary">Recently resolved</h2>
          <SuggestionModerationPanel suggestions={resolved.slice(0, 20)} canResolve={false} />
        </section>
      )}
    </div>
  );
}
