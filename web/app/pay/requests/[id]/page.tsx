import { notFound } from "next/navigation";
import { PageHeader } from "../../../../components/PageHeader";
import { EmptyState } from "../../../../components/EmptyState";
import { Badge } from "../../../../components/Badge";
import { PaymentRequestActions } from "../../../../components/pay/PaymentRequestActions";
import { getActiveWorkspaceId } from "../../../../lib/queries";
import { formatMoney, isSupportedCurrency } from "../../../../lib/money";
import { formatMsisdn } from "../../../../lib/payment-requests/public-view";
import { isPaymentRequestsEnabledForWorkspace, statusBadge } from "../../../../lib/payment-requests/owner";
import { getMatchCandidates, getPaymentRequest, getRequestEvents } from "../../../../lib/payment-requests/owner-data";

export const dynamic = "force-dynamic";

const EVENT_LABEL: Record<string, string> = {
  created: "Request created",
  cancelled: "Cancelled",
  marked_paid_by_owner: "Marked paid by you (not verified)",
  matched: "Linked to an incoming payment",
};

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-border-subtle py-2 text-sm">
      <span className="text-text-muted">{label}</span>
      <span className="text-right text-text-primary">{value}</span>
    </div>
  );
}

export default async function PaymentRequestDetailPage({ params }: PageProps<"/pay/requests/[id]">) {
  const { id } = await params;
  const workspaceId = await getActiveWorkspaceId();
  const enabled = isPaymentRequestsEnabledForWorkspace(
    {
      PAYMENT_REQUESTS_ENABLED: process.env.PAYMENT_REQUESTS_ENABLED,
      PAYMENT_REQUESTS_WORKSPACE_ALLOWLIST: process.env.PAYMENT_REQUESTS_WORKSPACE_ALLOWLIST,
    },
    workspaceId,
  );
  if (!enabled || !workspaceId) {
    return (
      <div>
        <PageHeader title="Payment request" backHref="/pay/requests" backLabel="Payment requests" />
        <EmptyState title="Payment requests aren't available yet" description="This feature isn't turned on for your account." />
      </div>
    );
  }

  const r = await getPaymentRequest(workspaceId, id);
  if (!r) notFound();
  const [events, candidates] = await Promise.all([
    getRequestEvents(r.id),
    r.status === "open" || r.status === "expired" ? getMatchCandidates(r) : Promise.resolve([]),
  ]);
  const b = statusBadge(r.status);
  const amount = isSupportedCurrency(r.currency)
    ? formatMoney(BigInt(r.amount_minor), r.currency)
    : `${r.amount_minor} ${r.currency}`;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={amount} subtitle={r.recipient_display} backHref="/pay/requests" backLabel="Payment requests" action={<Badge variant={b.variant}>{b.label}</Badge>} />

      {r.status === "marked_paid_by_owner" ? (
        <p className="rounded-card border border-attention/30 bg-attention-bg p-3 text-sm text-attention">
          You marked this as paid. OneLedger has not verified it.
        </p>
      ) : null}

      <div className="rounded-card border border-border-subtle bg-surface p-4">
        <Field
          label={r.destination_type === "momo_phone" ? "Mobile Money number" : "Merchant code"}
          value={r.destination_type === "momo_phone" ? formatMsisdn(r.destination_value) : r.destination_value}
        />
        {r.reference ? <Field label="Reference" value={r.reference} /> : null}
        <Field label="Valid until" value={new Date(r.expires_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Kigali" })} />
        <Field label="Created" value={new Date(r.created_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Kigali" })} />
      </div>

      <p className="text-xs text-text-muted">
        The payment link was shown once, when you created this request, and can&apos;t be shown
        again. To share a new link, cancel this request and create another.
      </p>

      <PaymentRequestActions
        id={r.id}
        status={r.status}
        candidates={candidates.map((c) => ({
          id: c.id,
          who: c.counterparty_name ?? "Unknown sender",
          when: new Date(c.occurred_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Kigali" }),
        }))}
      />

      <section aria-labelledby="hist-h" className="flex flex-col gap-2">
        <h2 id="hist-h" className="text-sm font-semibold text-text-primary">History</h2>
        <ul className="flex flex-col gap-1 text-sm text-text-secondary">
          {events.map((e) => (
            <li key={e.id}>
              {EVENT_LABEL[e.event_type] ?? e.event_type}
              <span className="text-text-muted"> · {new Date(e.created_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Kigali" })}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
