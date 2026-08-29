import Link from "next/link";
import { buildIngestEndpointUrl } from "../../../../lib/ingest";
import {
  MTN_SENDER_PLACEHOLDER,
  shortcutGuideSteps,
  SHORTCUT_TROUBLESHOOTING,
} from "../../../../lib/shortcut-guide";
import { PageHeader } from "../../../../components/PageHeader";
import { ShortcutGuide } from "../../../../components/ShortcutGuide";

export const dynamic = "force-dynamic";

export default function ShortcutSetupPage() {
  const endpointUrl = buildIngestEndpointUrl(
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL,
  );

  // Optional overrides, so the guide can be corrected without a code
  // change. MOMO_SMS_SENDER: the real MTN Rwanda MoMo SMS sender ID once
  // confirmed on a device. NEXT_PUBLIC_MOMO_SHORTCUT_URL: a signed
  // .shortcut / iCloud link, if one is ever published.
  const mtnSender = process.env.MOMO_SMS_SENDER?.trim() || null;
  const shortcutUrl = process.env.NEXT_PUBLIC_MOMO_SHORTCUT_URL?.trim() || null;

  const steps = shortcutGuideSteps({ endpointUrl, mtnSender });
  const senderUnconfirmed = !mtnSender;

  return (
    <div>
      <PageHeader
        title="Set up a device"
        subtitle="Forward your MTN MoMo SMS with an iPhone Shortcut"
      />

      <div className="mb-4 flex flex-col gap-2 text-sm text-text-secondary">
        <p>
          This wires your phone to a connection you&apos;ve already created
          under{" "}
          <Link
            href="/settings/connections"
            className="font-medium text-accent hover:underline"
          >
            Connections
          </Link>
          . Create one first if you haven&apos;t — you&apos;ll need the
          one-time <code className="rounded bg-background px-1 py-0.5">pfe_…</code>
          {" "}
          key it shows you.
        </p>
        {senderUnconfirmed && (
          <p className="rounded-control border border-border-subtle bg-surface p-3 text-xs text-text-muted">
            Note: the SMS sender to match in Step 2 is shown as{" "}
            <code className="rounded bg-background px-1 py-0.5">
              {MTN_SENDER_PLACEHOLDER}
            </code>{" "}
            until it&apos;s confirmed on a real device. Use whatever name
            MoMo messages actually arrive from on your phone.
          </p>
        )}
      </div>

      <ShortcutGuide
        steps={steps}
        troubleshooting={SHORTCUT_TROUBLESHOOTING}
        shortcutUrl={shortcutUrl}
      />

      <p className="mt-6 text-xs text-text-muted">
        On Android or for testing, the same request works from any HTTP
        client — see{" "}
        <span className="font-medium">docs/momo-ingest-contract.md</span> for a
        cURL example.
      </p>
    </div>
  );
}
