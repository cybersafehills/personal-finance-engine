import { OneLedgerLogo } from "../brand/OneLedgerLogo";

// The privacy policy for the OneLedger mobile app (Android + iPhone, ADR
// 0019). Rendered at /legal/privacy (canonical) and /legal/android-privacy
// (the URL already given to the Play Console for package
// me.oneledger.companion, which the new app replaces). This component is the
// source of truth for the wording; docs/mobile-release.md maps it to the
// store privacy forms. Change what the app collects => change this text in
// the same PR. Have counsel review before a production release.

export const MOBILE_PRIVACY_LAST_UPDATED = "15 November 2026";

const code = "rounded bg-surface px-1 py-0.5 text-xs";
const body = "text-sm leading-relaxed text-text-primary";
const list = "flex list-disc flex-col gap-2 pl-5 text-sm leading-relaxed text-text-primary";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-base font-semibold text-text-primary">{title}</h2>
      {children}
    </section>
  );
}

export function MobilePrivacyPolicy() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-12">
      <header className="flex flex-col gap-3">
        <OneLedgerLogo height={32} />
        <h1 className="text-xl font-semibold text-text-primary">
          OneLedger mobile app — Privacy Policy
        </h1>
        <p className="text-sm text-text-muted">
          Last updated: {MOBILE_PRIVACY_LAST_UPDATED}
        </p>
      </header>

      <p className={body}>
        The <strong>OneLedger mobile app</strong> (&ldquo;the app&rdquo;;
        Android package <code className={code}>me.oneledger.companion</code>, iOS
        bundle <code className={code}>me.oneledger.app</code>) is the phone
        companion to the OneLedger personal-finance service. It shows{" "}
        <strong>your own OneLedger account</strong> on your phone and, on
        Android, records your mobile-money transaction notifications into it
        automatically. This policy covers the app. It replaces the earlier
        &ldquo;OneLedger Shortcuts&rdquo; Android app, which this app supersedes.
      </p>

      <Section title="Your account">
        <ul className={list}>
          <li>
            You sign in with your OneLedger email and password (and a
            verification code if you turned on two-step verification). The
            sign-in session is kept in your phone&rsquo;s secure storage (Android
            Keystore / iOS Keychain) so you stay signed in, and is removed when
            you sign out.
          </li>
          <li>
            Once signed in, the app reads your own OneLedger data over an
            encrypted HTTPS connection to display it: transactions, balance,
            categories, budget progress and notifications. It can also record the decisions you
            make in the app, such as accepting a suggested category, adding a
            transaction by hand or marking a notification as read. The app sees only what you could already see by
            signing in on the web.
          </li>
          <li>
            You can hide amounts on screen with the app&rsquo;s privacy mode.
            That is a display setting on your phone.
          </li>
        </ul>
      </Section>

      <Section title="App lock (Face ID, fingerprint)">
        <p className={body}>
          You can lock the app behind your phone&rsquo;s biometric check or
          screen-lock. The check is performed by your phone&rsquo;s operating
          system. The app is told only whether it succeeded;{" "}
          <strong>
            it never receives, stores or transmits your fingerprint, face or any
            biometric data
          </strong>
          .
        </p>
      </Section>

      <Section title="Android: automatic capture of mobile-money notifications">
        <ul className={list}>
          <li>
            <strong>Notification access</strong> (
            <code className={code}>BIND_NOTIFICATION_LISTENER_SERVICE</code>),
            which you grant explicitly in Android Settings. The app inspects the
            text of posted notifications <strong>on your phone</strong> and
            keeps a notification only if it matches a known financial-provider
            message pattern (for example an MTN Mobile Money transaction alert).
          </li>
          <li>
            Only a matching notification is sent, over HTTPS, to your OneLedger
            account: its text, the time it was posted, the package name of the
            app that posted it, and the app version.{" "}
            <strong>
              Every notification that does not match is discarded on the phone
            </strong>{" "}
            — it is not parsed further, stored, transmitted or logged.
          </li>
          <li>
            If the phone is offline, matched messages wait in a small encrypted
            local queue (at most 500) and are removed as soon as OneLedger
            confirms receipt.
          </li>
          <li>
            Connecting the phone swaps a one-time code for a device credential
            that the app creates and stores encrypted on the phone. It
            authenticates the capture requests, is not a device identifier, is
            never shown, and is discarded when you disconnect or uninstall.
          </li>
          <li>
            The app does <strong>not</strong> request SMS, call logs, contacts,
            location, photos, files, the camera or the microphone.
          </li>
        </ul>
      </Section>

      <Section title="iPhone: Shortcuts">
        <p className={body}>
          iOS does not let any app read other apps&rsquo; notifications, and this
          app does not try to. On iPhone you can set up an Apple Shortcuts
          automation that, when a mobile-money message arrives, sends that
          message&rsquo;s text to your OneLedger account. You create and control
          the automation in Apple&rsquo;s Shortcuts app. The OneLedger app only
          creates a one-time pairing code for you to hand to the Shortcut; the
          device credential is generated and held by the Shortcut.
        </p>
      </Section>

      <Section title="Phone alerts (push notifications)">
        <p className={body}>
          Alerts are <strong>off until you turn them on</strong> in the app and
          allow notifications in the system prompt. When on, the app sends your
          phone&rsquo;s push token and platform (Android or iOS) to OneLedger.
          OneLedger then sends your account notifications to your phone through
          Expo&rsquo;s push service and Google (Android) or Apple (iPhone), which
          carry the notification&rsquo;s title and text to your phone. Those
          providers handle it only to deliver the alert. Turning alerts off or
          signing out removes the token from OneLedger.
        </p>
      </Section>

      <Section title="What we do not do">
        <p className={body}>
          The app contains no advertising or analytics SDK, does not track you
          across other apps or sites, and does not sell or share your data for
          advertising. Your data is shared only with the service providers that
          host and run OneLedger and, if you turn alerts on, the push providers
          above.
        </p>
      </Section>

      <Section title="Retention and deletion">
        <p className={body}>
          Data the app records is stored in your OneLedger account. You can view,
          export or delete it through your account on the web. Signing out
          removes the session and push token from the phone and OneLedger;
          disconnecting capture, or uninstalling the app, stops all further
          capture and erases the app&rsquo;s local data, including the device
          credential and any queued messages.
        </p>
      </Section>

      <Section title="Children">
        <p className={body}>
          The app is not directed to children and is intended for account holders
          aged 18 or older.
        </p>
      </Section>

      <Section title="Changes">
        <p className={body}>
          Material changes will be reflected here with an updated date and,
          where appropriate, in the app.
        </p>
      </Section>

      <Section title="Contact">
        <p className={body}>
          Questions:{" "}
          <a className="text-text-primary underline" href="mailto:privacy@oneledger.me">
            privacy@oneledger.me
          </a>
        </p>
      </Section>
    </div>
  );
}
