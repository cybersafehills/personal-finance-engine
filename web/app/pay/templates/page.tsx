import { PageHeader } from "../../../components/PageHeader";
import { EmptyState } from "../../../components/EmptyState";
import { PaymentTemplatesManager } from "../../../components/pay/PaymentTemplatesManager";
import { getActiveWorkspaceId } from "../../../lib/queries";
import { isPaymentTemplatesEnabled } from "../../../lib/pay/gate";
import { getPaymentTemplates } from "../../../lib/pay/intents";
import { messages } from "../../../lib/ussd/messages";

export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  const workspaceId = await getActiveWorkspaceId();
  const t = messages().pay.assisted;

  if (!isPaymentTemplatesEnabled(workspaceId)) {
    return (
      <div>
        <PageHeader title={t.templatesTitle} backHref="/pay/activity" backLabel={t.activityTitle} />
        <EmptyState
          title={messages().pay.disabledTitle}
          description={messages().pay.disabledBody}
        />
      </div>
    );
  }

  const templates = await getPaymentTemplates();

  return (
    <div>
      <PageHeader
        title={t.templatesTitle}
        subtitle={t.templatesEmpty}
        backHref="/pay/activity"
        backLabel={t.activityTitle}
      />
      <PaymentTemplatesManager
        initial={templates.map((tpl) => ({
          id: tpl.id,
          name: tpl.name,
          payment_type: tpl.payment_type,
          default_amount_minor: tpl.default_amount_minor,
          currency: tpl.currency,
        }))}
      />
    </div>
  );
}
