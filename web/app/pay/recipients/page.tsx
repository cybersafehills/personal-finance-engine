import { PageHeader } from "../../../components/PageHeader";
import { EmptyState } from "../../../components/EmptyState";
import { TrustedRecipientsManager } from "../../../components/pay/TrustedRecipientsManager";
import { getActiveWorkspaceId } from "../../../lib/queries";
import { isTrustedRecipientsEnabled } from "../../../lib/pay/gate";
import { getTrustedRecipients } from "../../../lib/pay/intents";
import { messages } from "../../../lib/ussd/messages";

export const dynamic = "force-dynamic";

export default async function RecipientsPage() {
  const workspaceId = await getActiveWorkspaceId();
  const t = messages().pay.assisted;

  if (!isTrustedRecipientsEnabled(workspaceId)) {
    return (
      <div>
        <PageHeader title={t.recipientsTitle} backHref="/pay/activity" backLabel={t.activityTitle} />
        <EmptyState
          title={messages().pay.disabledTitle}
          description={messages().pay.disabledBody}
        />
      </div>
    );
  }

  const recipients = await getTrustedRecipients();

  return (
    <div>
      <PageHeader
        title={t.recipientsTitle}
        subtitle={t.recipientsEmpty}
        backHref="/pay/activity"
        backLabel={t.activityTitle}
      />
      <TrustedRecipientsManager
        initial={recipients.map((r) => ({
          id: r.id,
          display_name: r.display_name,
          kind: r.kind,
          normalized_msisdn: r.normalized_msisdn,
          merchant_code: r.merchant_code,
          trust_status: r.trust_status,
        }))}
      />
    </div>
  );
}
