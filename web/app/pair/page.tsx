import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OneLedgerLogo } from "../../components/brand/OneLedgerLogo";
import { PairHandoff } from "../../components/PairHandoff";
import { devicePairingV2Enabled, PAIRING_TOKEN_PATTERN } from "../../lib/pairing";

export const dynamic = "force-dynamic";

// The pairing code is a single-use, ~10-minute token carried in the URL so it
// can be scanned onto a phone. Keep it out of Referer headers to downstream
// links/assets — same posture as a magic link.
export const metadata: Metadata = { referrer: "no-referrer" };

export default async function PairPage({
  searchParams,
}: PageProps<"/pair">) {
  if (!devicePairingV2Enabled(process.env.DEVICE_PAIRING_V2)) {
    notFound();
  }

  const params = await searchParams;
  const raw = params.c;
  const code = typeof raw === "string" ? raw : "";
  const valid = PAIRING_TOKEN_PATTERN.test(code);
  const platform = params.p === "android" ? "android" : "ios";

  const shortcutUrl = process.env.NEXT_PUBLIC_MOMO_SHORTCUT_URL?.trim() || null;
  const captureShortcutUrl =
    process.env.NEXT_PUBLIC_MOMO_CAPTURE_SHORTCUT_URL?.trim() || null;
  const androidCompanionUrl =
    process.env.NEXT_PUBLIC_ANDROID_COMPANION_URL?.trim() || null;

  return (
    <div className="mx-auto flex max-w-sm flex-col gap-6 py-10">
      <div className="text-center">
        <OneLedgerLogo height={36} className="mx-auto mb-4" />
        <h1 className="text-xl font-semibold text-text-primary">
          {platform === "android" ? "Connect this phone" : "Connect this iPhone"}
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          Automatically record supported transaction messages in OneLedger.
        </p>
      </div>

      {valid
        ? (
          <PairHandoff
            token={code}
            platform={platform}
            shortcutUrl={shortcutUrl}
            captureShortcutUrl={captureShortcutUrl}
            companionUrl={androidCompanionUrl}
          />
        )
        : (
          <div className="flex flex-col gap-3 rounded-card border border-border-subtle bg-surface p-4 text-sm text-text-secondary">
            <p className="font-medium text-text-primary">
              This link is no longer valid.
            </p>
            <p>
              Pairing codes last about 10 minutes and work once. Go back to the
              device where you started and get a fresh code.
            </p>
          </div>
        )}
    </div>
  );
}
