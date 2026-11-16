import { PageHeader } from "../../../../components/PageHeader";
import { EmptyState } from "../../../../components/EmptyState";
import { PaymentRequestForm } from "../../../../components/pay/PaymentRequestForm";
import { getActiveWorkspaceId } from "../../../../lib/queries";
import { isPaymentRequestsEnabledForWorkspace } from "../../../../lib/payment-requests/owner";
import { requireMfaForSensitiveAction } from "../../../../lib/auth/assurance";
import { supabaseSession } from "../../../../lib/supabase-session-server";

export const dynamic = "force-dynamic";

export default async function NewPaymentRequestPage() {
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
        <PageHeader title="New payment request" backHref="/pay/requests" backLabel="Payment requests" />
        <EmptyState title="Payment requests aren't available yet" description="This feature isn't turned on for your account." />
      </div>
    );
  }
  await requireMfaForSensitiveAction("/pay/requests/new");

  const supabase = await supabaseSession();
  const { data: { user } } = await supabase.auth.getUser();
  const meta = (user?.user_metadata ?? {}) as { full_name?: string; name?: string };
  const defaultName = (meta.full_name ?? meta.name ?? "").slice(0, 80);

  return (
    <div>
      <PageHeader title="New payment request" backHref="/pay/requests" backLabel="Payment requests" />
      <PaymentRequestForm defaultName={defaultName} />
    </div>
  );
}
