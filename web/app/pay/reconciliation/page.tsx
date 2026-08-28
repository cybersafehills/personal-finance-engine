import { PageHeader } from "../../../components/PageHeader";
import { EmptyState } from "../../../components/EmptyState";
import { ReconciliationQueue } from "../../../components/pay/ReconciliationQueue";
import { getActiveWorkspaceId } from "../../../lib/queries";
import { isPaymentIntentSurfaceEnabled, smsReconciliationMode } from "../../../lib/pay/gate";
import { getReconciliationQueue } from "../../../lib/pay/intents";
import { messages } from "../../../lib/ussd/messages";

export const dynamic = "force-dynamic";

export default async function ReconciliationPage() {
  const workspaceId = await getActiveWorkspaceId();
  const t = messages().pay.assisted;

  if (!isPaymentIntentSurfaceEnabled(workspaceId)) {
    return (
      <div>
        <PageHeader title={t.recon.title} backHref="/pay/activity" backLabel={t.activityTitle} />
        <EmptyState
          title={messages().pay.disabledTitle}
          description={messages().pay.disabledBody}
        />
      </div>
    );
  }

  const { candidates, requiresReconciliation } = await getReconciliationQueue();

  return (
    <div>
      <PageHeader
        title={t.recon.title}
        backHref="/pay/activity"
        backLabel={t.activityTitle}
      />
      <ReconciliationQueue
        observeMode={smsReconciliationMode() === "observe"}
        candidates={candidates.map((c) => ({
          id: c.id,
          status: c.status,
          match_method: c.match_method,
          matched_on: c.matched_on,
          intent: c.intent,
          transaction: c.transaction
            ? {
                id: c.transaction.id,
                occurred_at: c.transaction.occurred_at,
                amount_rwf: c.transaction.amount_rwf,
                fee_rwf: c.transaction.fee_rwf,
                counterparty_name: c.transaction.counterparty_name,
              }
            : null,
        }))}
        requiresReconciliation={requiresReconciliation.map((r) => ({
          id: r.id,
          recipient_name: r.recipient_name,
          amount_minor: r.amount_minor,
          currency: r.currency,
          created_at: r.created_at,
        }))}
      />
    </div>
  );
}
