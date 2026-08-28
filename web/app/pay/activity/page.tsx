import Link from "next/link";
import { PageHeader } from "../../../components/PageHeader";
import { EmptyState } from "../../../components/EmptyState";
import { Badge } from "../../../components/Badge";
import { getActiveWorkspaceId } from "../../../lib/queries";
import { isPaymentIntentSurfaceEnabled } from "../../../lib/pay/gate";
import { getPaymentActivity } from "../../../lib/pay/intents";
import { statusLabel, statusTone } from "../../../lib/pay/state";
import { messages } from "../../../lib/ussd/messages";

export const dynamic = "force-dynamic";

const TONE_VARIANT = { positive: "positive", attention: "attention", neutral: "neutral" } as const;
const TYPE_LABEL: Record<string, string> = {
  pay_person: "Pay a person",
  pay_merchant: "Pay a merchant",
  pay_bill: "Pay a bill",
  buy_electricity: "Buy electricity",
  buy_airtime: "Buy airtime or data",
  government: "Government services",
};

export default async function PaymentActivityPage() {
  const workspaceId = await getActiveWorkspaceId();
  const t = messages().pay.assisted;

  if (!isPaymentIntentSurfaceEnabled(workspaceId)) {
    return (
      <div>
        <PageHeader title={t.activityTitle} />
        <EmptyState
          title={messages().pay.disabledTitle}
          description={messages().pay.disabledBody}
        />
      </div>
    );
  }

  const intents = await getPaymentActivity({ limit: 100 });

  return (
    <div>
      <PageHeader
        title={t.activityTitle}
        backHref="/"
        backLabel="Home"
        action={
          <div className="flex flex-wrap gap-3 text-sm">
            <Link href="/pay/reconciliation" className="font-medium text-accent">
              {t.recon.title}
            </Link>
            <Link href="/pay/recipients" className="font-medium text-accent">
              {t.recipientsTitle}
            </Link>
            <Link href="/pay/templates" className="font-medium text-accent">
              {t.templatesTitle}
            </Link>
          </div>
        }
      />

      {intents.length === 0 ? (
        <EmptyState title={t.activityEmpty} />
      ) : (
        <ul>
          {intents.map((i) => {
            const amountMajor = i.currency === "RWF" ? i.amount_minor : i.amount_minor / 100;
            return (
              <li
                key={i.id}
                className="flex items-center justify-between gap-3 border-b border-border-subtle py-3 last:border-b-0"
              >
                <Link href={`/pay/${i.id}`} className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-medium text-text-primary">
                      {i.recipient_name ?? i.merchant_code ?? i.meter_number ?? "Payment"}
                    </span>
                    <span className="text-sm text-text-muted">
                      {amountMajor} {i.currency}
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-text-muted">
                    <span>{TYPE_LABEL[i.payment_type] ?? i.payment_type}</span>
                    <span aria-hidden="true">·</span>
                    <span>{new Date(i.created_at).toLocaleDateString()}</span>
                    {i.source === "qr_scan" && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>{t.fromScan}</span>
                      </>
                    )}
                  </div>
                </Link>
                <Badge variant={TONE_VARIANT[statusTone(i)]}>{statusLabel(i)}</Badge>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
