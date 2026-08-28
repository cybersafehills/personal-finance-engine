import { notFound } from "next/navigation";
import { PageHeader } from "../../../components/PageHeader";
import { EmptyState } from "../../../components/EmptyState";
import { PaymentIntentPanel } from "../../../components/pay/PaymentIntentPanel";
import { getAccounts, getActiveWorkspaceId, getBudgets } from "../../../lib/queries";
import { isPaymentIntentSurfaceEnabled } from "../../../lib/pay/gate";
import {
  getPaymentIntent,
  getTrustedRecipients,
  getUnlinkedRecentTransactions,
  isSessionFresh,
} from "../../../lib/pay/intents";
import { getServiceCodeById } from "../../../lib/ussd/queries";
import { messages } from "../../../lib/ussd/messages";

export const dynamic = "force-dynamic";

export default async function PaymentIntentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const workspaceId = await getActiveWorkspaceId();
  if (!isPaymentIntentSurfaceEnabled(workspaceId)) {
    return (
      <div>
        <PageHeader title="Pay" backHref="/pay/activity" backLabel="Payment activity" />
        <EmptyState
          title={messages().pay.disabledTitle}
          description={messages().pay.disabledBody}
        />
      </div>
    );
  }

  const { id } = await params;
  const result = await getPaymentIntent(id);
  if (!result) notFound();
  const { intent, events, reconciliations, linkedTransaction } = result;

  const needsLinkPicker =
    !intent.linked_transaction_id &&
    ["initiated", "awaiting_verification", "requires_reconciliation"].includes(intent.state);

  const [accounts, budgets, recipients, serviceCode, sessionFresh, unlinkedTransactions] =
    await Promise.all([
      getAccounts(),
      getBudgets(),
      getTrustedRecipients(),
      intent.service_code_id ? getServiceCodeById(intent.service_code_id) : Promise.resolve(null),
      isSessionFresh(),
      needsLinkPicker ? getUnlinkedRecentTransactions(id) : Promise.resolve([]),
    ]);

  const sourceAccountName =
    accounts.find((a) => a.id === intent.source_account_id)?.name ?? null;
  const budgetName = budgets.find((b) => b.id === intent.budget_id)?.name ?? null;
  const trust = recipients.find((r) => r.id === intent.trusted_recipient_id);

  return (
    <div>
      <PageHeader
        title={messages().pay.assisted.reviewTitle}
        backHref="/pay/activity"
        backLabel={messages().pay.assisted.activityTitle}
      />

      <PaymentIntentPanel
        intent={intent}
        serviceCode={
          serviceCode
            ? {
                ussd_template: serviceCode.ussd_template,
                accepts_parameters: serviceCode.accepts_parameters,
                slug: serviceCode.slug,
                parameters: serviceCode.parameters.map((p) => ({
                  key: p.key,
                  kind: p.kind,
                  required: p.required,
                  format_regex: p.format_regex,
                  min_length: p.min_length,
                  max_length: p.max_length,
                })),
              }
            : null
        }
        sessionFresh={sessionFresh}
        sourceAccountName={sourceAccountName}
        budgetName={budgetName}
        trustStatus={trust?.trust_status ?? null}
        reconciliations={reconciliations.map((r) => ({
          id: r.id,
          transaction_id: r.transaction_id,
          match_method: r.match_method,
          status: r.status,
          applied_at: r.applied_at,
          matched_on: r.matched_on,
        }))}
        linkedTransaction={
          linkedTransaction
            ? {
                id: linkedTransaction.id,
                occurred_at: linkedTransaction.occurred_at,
                amount_rwf: linkedTransaction.amount_rwf,
                fee_rwf: linkedTransaction.fee_rwf,
                counterparty_name: linkedTransaction.counterparty_name,
              }
            : null
        }
        unlinkedTransactions={unlinkedTransactions.map((tx) => ({
          id: tx.id,
          occurred_at: tx.occurred_at,
          amount_rwf: tx.amount_rwf,
          counterparty_name: tx.counterparty_name,
        }))}
      />

      <section className="mt-8">
        <h2 className="mb-2 text-sm font-semibold text-text-secondary">
          {messages().pay.assisted.timeline}
        </h2>
        <ol className="flex flex-col gap-2 text-sm">
          {events.map((e) => (
            <li key={e.id} className="flex items-baseline justify-between gap-3">
              <span className="text-text-primary">
                {e.event_type.replace(/_/g, " ")}
                {e.from_state && e.to_state ? ` (${e.from_state} → ${e.to_state})` : ""}
              </span>
              <span className="shrink-0 text-xs text-text-muted">
                {new Date(e.created_at).toLocaleString()}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
