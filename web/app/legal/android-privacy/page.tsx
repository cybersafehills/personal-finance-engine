import type { Metadata } from "next";
import { OneLedgerLogo } from "../../../components/brand/OneLedgerLogo";

// Public, static, crawlable. This URL is the "Privacy policy" field in the
// Google Play Console listing for the OL Shortcuts Android app (package
// `me.oneledger.companion`), so it must resolve without a OneLedger session —
// `/legal` is in PUBLIC_PATHS (web/proxy.ts). Source of truth for the wording
// is docs/android-companion-privacy-policy.md; keep the two in step.
export const metadata: Metadata = {
  title: "OneLedger Shortcuts — Privacy Policy",
  description:
    "How the OneLedger Shortcuts Android app handles notification access, camera, and the data it forwards to your OneLedger account.",
  robots: { index: true, follow: true },
};

const LAST_UPDATED = "5 September 2026";

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-base font-semibold text-text-primary">{title}</h2>
      {children}
    </section>
  );
}

export default function AndroidPrivacyPolicyPage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-12">
      <header className="flex flex-col gap-3">
        <OneLedgerLogo height={32} />
        <h1 className="text-xl font-semibold text-text-primary">
          OneLedger Shortcuts — Privacy Policy
        </h1>
        <p className="text-sm text-text-muted">Last updated: {LAST_UPDATED}</p>
      </header>

      <p className="text-sm leading-relaxed text-text-primary">
        <strong>OneLedger Shortcuts</strong> (&ldquo;the app&rdquo;, package{" "}
        <code className="rounded bg-surface px-1 py-0.5 text-xs">
          me.oneledger.companion
        </code>
        ) is a companion to the OneLedger personal-finance service. It exists to
        do one thing: forward supported financial-transaction notifications from
        your Android phone to <strong>your own OneLedger account</strong>, so
        those transactions are recorded automatically.
      </p>

      <Section title="What the app accesses">
        <ul className="flex list-disc flex-col gap-2 pl-5 text-sm leading-relaxed text-text-primary">
          <li>
            <strong>Notification access</strong> (
            <code className="rounded bg-surface px-1 py-0.5 text-xs">
              BIND_NOTIFICATION_LISTENER_SERVICE
            </code>
            ), which you grant explicitly in Android Settings. The app inspects
            the text of posted notifications <strong>on your device</strong> and
            keeps a notification only if its content matches a known
            financial-provider message pattern (for example, an MTN Mobile Money
            transaction alert).
          </li>
          <li>
            <strong>Camera</strong> — only when you tap &ldquo;scan&rdquo; during
            setup, to read a pairing-code QR. The preview is decoded on-device;
            no photo or video is captured, stored, or transmitted. You can
            decline and type the code instead.
          </li>
          <li>
            The app does <strong>not</strong> request or access SMS, call logs,
            contacts, location, photos, files, or the microphone.
          </li>
        </ul>
      </Section>

      <Section title="What leaves your device">
        <p className="text-sm leading-relaxed text-text-primary">
          Only when a notification matches a supported provider pattern, the app
          sends — over an encrypted HTTPS connection, to the OneLedger service,
          associated with your account:
        </p>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm leading-relaxed text-text-primary">
          <li>the matched notification&rsquo;s text body,</li>
          <li>the time it was posted,</li>
          <li>the package name of the app that posted it,</li>
          <li>the app version.</li>
        </ul>
        <p className="text-sm leading-relaxed text-text-primary">
          <strong>
            Every notification that does not match is discarded on the device
          </strong>{" "}
          — it is not parsed further, not stored, not transmitted, and not
          written to any log. The app contains no analytics or advertising SDK
          and sends data to no third party.
        </p>
      </Section>

      <Section title="Pairing credential">
        <p className="text-sm leading-relaxed text-text-primary">
          When you connect the app to OneLedger you exchange a short-lived
          one-time code for a device credential that the app generates and stores
          encrypted on your device (Android{" "}
          <code className="rounded bg-surface px-1 py-0.5 text-xs">
            EncryptedSharedPreferences
          </code>
          ). This credential authenticates the app&rsquo;s requests to OneLedger.
          It is not a device identifier, is never shown to you, and is not
          shared. You can revoke it at any time by disconnecting the phone in the
          app or removing the connection in OneLedger on the web; reinstalling
          the app also discards it.
        </p>
      </Section>

      <Section title="Data retention and deletion">
        <p className="text-sm leading-relaxed text-text-primary">
          Transaction data the app forwards is stored in your OneLedger account
          and is governed by the OneLedger Privacy Policy. You can view, export,
          or delete it through your OneLedger account. Uninstalling the app stops
          all further capture and erases the app&rsquo;s local data (the pairing
          credential and any not-yet-sent messages in its local queue).
        </p>
      </Section>

      <Section title="On-device queue">
        <p className="text-sm leading-relaxed text-text-primary">
          If your phone is offline, matched messages wait in a small encrypted
          local queue (bounded to 500 entries) and are sent once connectivity
          returns. Entries are deleted as soon as the OneLedger service confirms
          receipt.
        </p>
      </Section>

      <Section title="Children">
        <p className="text-sm leading-relaxed text-text-primary">
          The app is not directed to children and is intended for account holders
          aged 18 or older.
        </p>
      </Section>

      <Section title="Changes">
        <p className="text-sm leading-relaxed text-text-primary">
          Material changes to this policy will be reflected here with an updated
          date and, where appropriate, in the app.
        </p>
      </Section>

      <Section title="Contact">
        <p className="text-sm leading-relaxed text-text-primary">
          Questions:{" "}
          <a
            className="text-text-primary underline"
            href="mailto:privacy@oneledger.me"
          >
            privacy@oneledger.me
          </a>
        </p>
      </Section>
    </div>
  );
}
