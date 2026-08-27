import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "../../../components/PageHeader";
import { EmptyState } from "../../../components/EmptyState";
import { Badge } from "../../../components/Badge";
import { AdminReportItem } from "../../../components/ussd/AdminReportItem";
import { isPlatformAdmin } from "../../../lib/pay/admin";
import { getAdminQueue, getAllServiceCodesForAdmin } from "../../../lib/ussd/admin-queries";
import { messages } from "../../../lib/ussd/messages";

export const dynamic = "force-dynamic";

const t = messages().admin;

const STATE_VARIANT: Record<string, "neutral" | "positive" | "attention"> = {
  published: "positive",
  draft: "neutral",
  pending_review: "attention",
  temporarily_unavailable: "attention",
  deprecated: "neutral",
  archived: "neutral",
};

export default async function AdminUssdPage() {
  if (!(await isPlatformAdmin())) notFound();

  const [queue, all] = await Promise.all([
    getAdminQueue(),
    getAllServiceCodesForAdmin(),
  ]);

  return (
    <div>
      <PageHeader
        title={t.title}
        subtitle={`${queue.publishedCount} published`}
        action={
          <Link
            href="/admin/ussd/new"
            className="min-h-11 rounded-control bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground"
          >
            {t.newCode}
          </Link>
        }
      />

      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold text-text-secondary">{t.queueTitle}</h2>
        <div className="grid gap-2 sm:grid-cols-3">
          <QueueStat label={t.drafts} count={queue.drafts.length} />
          <QueueStat label={t.pendingReview} count={queue.pendingReview.length} />
          <QueueStat label={t.openReports} count={queue.openReports.length} />
        </div>
      </section>

      {queue.pendingReview.length > 0 && (
        <QueueList heading={t.pendingReview} rows={queue.pendingReview} />
      )}
      {queue.drafts.length > 0 && <QueueList heading={t.drafts} rows={queue.drafts} />}
      {queue.reviewDue.length > 0 && (
        <QueueList heading="Re-verification due" rows={queue.reviewDue} />
      )}

      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold text-text-secondary">{t.openReports}</h2>
        {queue.openReports.length === 0 ? (
          <p className="text-sm text-text-muted">No open reports.</p>
        ) : (
          <ul>
            {queue.openReports.map((r) => (
              <AdminReportItem
                key={r.id}
                report={{
                  id: r.id,
                  report_type: r.report_type,
                  details: r.details,
                  status: r.status,
                  created_at: r.created_at,
                  codeLabel: r.service_code?.display_name_en ?? r.service_code_id,
                  codeSlug: r.service_code?.slug ?? null,
                }}
              />
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-text-secondary">All service codes</h2>
        {all.length === 0 ? (
          <EmptyState title="No service codes yet" description="Create the first one." />
        ) : (
          <ul>
            {all.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between gap-3 border-b border-border-subtle py-2.5 last:border-b-0"
              >
                <Link href={`/admin/ussd/${c.id}`} className="min-w-0 flex-1">
                  <span className="font-medium text-text-primary">{c.display_name_en}</span>
                  <span className="ml-2 font-mono text-xs text-text-muted">{c.provider.slug}</span>
                </Link>
                <div className="flex shrink-0 items-center gap-2">
                  {c.verified_at == null && <Badge variant="attention">Unverified</Badge>}
                  <Badge variant={STATE_VARIANT[c.state] ?? "neutral"}>{c.state}</Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function QueueStat({ label, count }: { label: string; count: number }) {
  return (
    <div className="rounded-control border border-border-subtle bg-surface px-3 py-2.5">
      <p className="text-2xl font-semibold text-text-primary">{count}</p>
      <p className="text-xs text-text-muted">{label}</p>
    </div>
  );
}

function QueueList({
  heading,
  rows,
}: {
  heading: string;
  rows: { id: string; display_name_en: string; provider: { slug: string }; state: string }[];
}) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-sm font-semibold text-text-secondary">{heading}</h2>
      <ul>
        {rows.map((c) => (
          <li key={c.id} className="border-b border-border-subtle py-2.5 last:border-b-0">
            <Link href={`/admin/ussd/${c.id}`} className="font-medium text-accent">
              {c.display_name_en}
            </Link>
            <span className="ml-2 font-mono text-xs text-text-muted">{c.provider.slug}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
