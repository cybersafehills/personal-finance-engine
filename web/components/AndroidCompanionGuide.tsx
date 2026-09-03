"use client";

/**
 * Install guide for the OneLedger Companion Android app, shown on the Pair
 * wizard's Install step when the user picked "Android phone". Presentation only
 * — the page resolves `companionUrl` (a Play listing / signed APK link) server
 * side. The Companion asks for notification access itself; this just sets
 * expectations. Parallels `ShortcutGuide` for iPhone.
 */
export function AndroidCompanionGuide({
  companionUrl,
}: {
  companionUrl: string | null;
}) {
  return (
    <div className="flex flex-col gap-6">
      {companionUrl
        ? (
          <a
            href={companionUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 w-fit items-center rounded-control bg-accent px-4 text-sm font-medium text-accent-foreground"
          >
            Get the OneLedger Companion app
          </a>
        )
        : (
          <p className="rounded-control border border-border-subtle bg-surface p-3 text-xs text-text-muted">
            The Companion app isn&apos;t published yet. If you have a build,
            install it on this phone, then continue.
          </p>
        )}

      <ol className="flex flex-col gap-5">
        {[
          {
            n: 1,
            title: "Install the app on the phone that gets the messages",
            body: [
              "The OneLedger Companion watches this phone for supported " +
              "transaction notifications (MTN MoMo today) and sends only " +
              "those to OneLedger.",
              "It never reads SMS and never sends anything else — every other " +
              "notification is ignored on the device.",
            ],
          },
          {
            n: 2,
            title: "Open it and pair with the code",
            body: [
              "On the next step OneLedger shows a one-time pairing code. Open " +
              "the Companion and enter it, or scan the QR with the phone's " +
              "camera to jump straight in.",
            ],
          },
          {
            n: 3,
            title: "Allow notification access when asked",
            body: [
              "Android shows a system list — pick OneLedger Companion and turn " +
              "it on. This is the only permission the app needs. You can turn " +
              "it off any time in Settings → Notification access.",
            ],
          },
        ].map((step) => (
          <li
            key={step.n}
            className="flex flex-col gap-2 rounded-card border border-border-subtle bg-surface p-4"
          >
            <div className="flex items-baseline gap-2">
              <span className="text-xs font-semibold text-text-muted">
                Step {step.n}
              </span>
              <h2 className="text-sm font-medium text-text-primary">
                {step.title}
              </h2>
            </div>
            {step.body.map((para, i) => (
              <p key={i} className="text-sm text-text-secondary">
                {para}
              </p>
            ))}
          </li>
        ))}
      </ol>
    </div>
  );
}
