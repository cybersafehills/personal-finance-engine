import Link from "next/link";
import { PageHeader } from "../../../components/PageHeader";
import { EmptyState } from "../../../components/EmptyState";
import { Badge } from "../../../components/Badge";
import { getActiveWorkspaceId } from "../../../lib/queries";
import { formatMoney, isSupportedCurrency } from "../../../lib/money";
import { isPaymentRequestsEnabledForWorkspace, statusBadge } from "../../../lib/payment-requests/owner";
import { listPaymentRequests } from "../../../lib/payment-requests/owner-data";

export const dynamic = "force-dynamic";

export default async function PaymentRequestsPage() {
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
        <PageHeader title="Payment requests" backHref="/pay/activity" backLabel="Payment activity" />
        <EmptyState
          title="Payment requests aren't available yet"
          description="This feature isn't turned on for your account."
        />
      </div>
    );
  }

  const requests = await listPaymentRequests(workspaceId);

  return (
    <div>
      <PageHeader
        title="Payment requests"
        subtitle="Ask someone to pay you with a link or QR code. OneLedger doesn't collect or verify the payment."
        backHref="/pay/activity"
        backLabel="Payment activity"
        action={
          <Link
            href="/pay/requests/new"
            className="inline-flex min-h-11 items-center rounded-control bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground"
          >
            New request
          </Link>
        }
      />
      {requests.length === 0 ? (
        <EmptyState
          title="No payment requests yet"
          description="Create one to get a shareable link and QR code."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {requests.map((r) => {
            const b = statusBadge(r.status);
            return (
              <li key={r.id}>
                <Link
                  href={`/pay/requests/${r.id}`}
                  className="flex items-center justify-between gap-3 rounded-card border border-border-subtle bg-surface p-3 hover:border-accent"
                >
                  <span className="flex flex-col">
                    <span className="text-sm font-medium text-text-primary">
                      {isSupportedCurrency(r.currency)
                        ? formatMoney(BigInt(r.amount_minor), r.currency)
                        : `${r.amount_minor} ${r.currency}`}
                      {r.reference ? ` · ${r.reference}` : ""}
                    </span>
                    <span className="text-xs text-text-muted">
                      {r.recipient_display} · created {new Date(r.created_at).toLocaleDateString("en-GB")}
                    </span>
                  </span>
                  <Badge variant={b.variant}>{b.label}</Badge>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
