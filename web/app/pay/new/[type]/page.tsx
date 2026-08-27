import { notFound } from "next/navigation";
import { PageHeader } from "../../../../components/PageHeader";
import { EmptyState } from "../../../../components/EmptyState";
import { PaymentDraftForm } from "../../../../components/pay/PaymentDraftForm";
import { getAccounts, getActiveWorkspaceId, getBudgets } from "../../../../lib/queries";
import { isAssistedPayEnabled } from "../../../../lib/pay/gate";
import { getRecentRecipients, getTrustedRecipients } from "../../../../lib/pay/intents";
import { messages } from "../../../../lib/ussd/messages";

export const dynamic = "force-dynamic";

const PAYMENT_TYPES = [
  "pay_person",
  "pay_merchant",
  "pay_bill",
  "buy_electricity",
  "buy_airtime",
  "government",
] as const;
type PaymentType = (typeof PAYMENT_TYPES)[number];

export default async function NewPaymentPage({
  params,
  searchParams,
}: {
  params: Promise<{ type: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { type } = await params;
  if (!(PAYMENT_TYPES as readonly string[]).includes(type)) notFound();
  const paymentType = type as PaymentType;

  const workspaceId = await getActiveWorkspaceId();
  if (!isAssistedPayEnabled(workspaceId)) {
    return (
      <div>
        <PageHeader title="Pay" backHref="/" backLabel="Home" />
        <EmptyState
          title={messages().pay.disabledTitle}
          description={messages().pay.disabledBody}
        />
      </div>
    );
  }

  const sp = await searchParams;
  const [accounts, budgets, trustedRecipients, recentRecipients] = await Promise.all([
    getAccounts(),
    getBudgets(),
    getTrustedRecipients(),
    getRecentRecipients(6),
  ]);

  const t = messages().pay.assisted;

  return (
    <div>
      <PageHeader
        title={t.newTitle[paymentType]}
        subtitle={t.feeNotice}
        backHref="/"
        backLabel="Home"
      />
      <PaymentDraftForm
        type={paymentType}
        accounts={accounts
          .filter((a) => a.is_active)
          .map((a) => ({ id: a.id, name: a.name, provider: a.provider, currency: a.currency }))}
        budgets={budgets
          .filter((b) => b.status === "active")
          .map((b) => ({ id: b.id, name: b.name, status: b.status }))}
        trustedRecipients={trustedRecipients.map((r) => ({
          id: r.id,
          display_name: r.display_name,
          kind: r.kind,
          normalized_msisdn: r.normalized_msisdn,
          merchant_code: r.merchant_code,
          trust_status: r.trust_status,
        }))}
        recentRecipients={recentRecipients}
        defaults={{
          accountId: typeof sp.account === "string" ? sp.account : undefined,
          budgetId: typeof sp.budget === "string" ? sp.budget : undefined,
          recipientId: typeof sp.recipient === "string" ? sp.recipient : undefined,
        }}
      />
    </div>
  );
}
