import { redirect } from "next/navigation";
import { getAccounts } from "../../../../lib/queries";
import { devicePairingV2Enabled } from "../../../../lib/pairing";
import { PageHeader } from "../../../../components/PageHeader";
import { PairWizard } from "../../../../components/PairWizard";

export const dynamic = "force-dynamic";

export default async function PairDevicePage() {
  // Same exact-match env var the `capture` Edge Function reads. Off ⇒ this
  // route self-forwards, so there is never a dead link while the feature is
  // dark (mirrors /get-started).
  if (!devicePairingV2Enabled(process.env.DEVICE_PAIRING_V2)) {
    redirect("/settings/connections");
  }

  const accounts = await getAccounts();
  const activeAccounts = accounts.filter((a) => a.is_active);

  const shortcutUrl = process.env.NEXT_PUBLIC_MOMO_SHORTCUT_URL?.trim() || null;
  const mtnSender = process.env.MOMO_SMS_SENDER?.trim() || null;

  return (
    <div>
      <PageHeader
        title="Connect your iPhone"
        subtitle="Automatically record supported transaction messages in OneLedger"
        backHref="/settings/connections"
        backLabel="Connections"
      />
      <PairWizard
        accounts={activeAccounts}
        shortcutUrl={shortcutUrl}
        mtnSender={mtnSender}
      />
    </div>
  );
}
