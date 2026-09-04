"use client";

import {
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import Link from "next/link";
import type { AccountRow } from "../lib/queries";
import {
  androidCompanionPairUrl,
  devicePairShortcutRunUrl,
  type PairPlatform,
  pairHandoffUrl,
} from "../lib/pairing";
import { QrCode } from "./QrCode";
import { AndroidCompanionGuide } from "./AndroidCompanionGuide";
import { ConnectionReadinessProbe } from "./ConnectionReadinessProbe";
import {
  type DevicePairingStatus,
  getDevicePairingStatus,
  startDevicePairing,
  type StartDevicePairingResult,
} from "../app/integrations/connections/pair/actions";

type Session = Extract<StartDevicePairingResult, { ok: true }>;

const STEP_LABELS: Record<PairPlatform, readonly string[]> = {
  ios: ["Account", "Install", "Pair", "Automate", "Verify"],
  android: ["Account", "Install", "Pair", "Allow access", "Verify"],
};
type StepKey = "service" | "install" | "pair" | "automate" | "verify" | "done";
const STEP_INDEX: Record<Exclude<StepKey, "done">, number> = {
  service: 0,
  install: 1,
  pair: 2,
  automate: 3,
  verify: 4,
};

const POLL_MS = 3_000;

export function PairWizard({
  accounts,
  shortcutUrl,
  captureShortcutUrl = null,
  mtnSender,
  androidCompanionUrl = null,
}: {
  accounts: AccountRow[];
  /** The one-time pairing Shortcut ("Connect to OneLedger") iCloud link. */
  shortcutUrl: string | null;
  /** The Messages-automation forwarder ("OneLedger Capture") iCloud link -
   *  a separate share, since sharing two Shortcuts as one link isn't
   *  supported on every iOS version. */
  captureShortcutUrl?: string | null;
  mtnSender: string | null;
  androidCompanionUrl?: string | null;
}) {
  const [step, setStep] = useState<StepKey>("service");
  const [platform, setPlatform] = useState<PairPlatform>("ios");
  const isAndroid = platform === "android";
  const steps = STEP_LABELS[platform];
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [session, setSession] = useState<Session | null>(null);
  const [deviceCredentialId, setDeviceCredentialId] = useState<string | null>(
    null,
  );
  const [pairError, setPairError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [copied, setCopied] = useState(false);
  // Purely local "I tapped this" memory for the Install step's two Shortcut
  // links - not persisted, not proof either Shortcut was actually added
  // (iOS never tells us that). Just enough to turn a clicked link into a
  // visibly settled state instead of looking identically untouched forever.
  const [connectAdded, setConnectAdded] = useState(false);
  const [captureAdded, setCaptureAdded] = useState(false);
  const [isStarting, startTransition] = useTransition();

  // Only offer the QR on a device with a fine pointer (a computer) — a phone
  // scanning a QR of its own screen makes no sense. Server snapshot is false,
  // so SSR + first client paint render no QR, then it appears if relevant.
  const isPointerFine = useSyncExternalStore(
    (onChange) => {
      const mq = globalThis.matchMedia("(pointer: fine)");
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => globalThis.matchMedia("(pointer: fine)").matches,
    () => false,
  );
  const handoffOrigin = isPointerFine ? globalThis.location.origin : null;

  const beginPairing = useCallback(() => {
    setPairError(null);
    setExpired(false);
    setSession(null);
    startTransition(async () => {
      const result = await startDevicePairing(accountId);
      if (result.ok) {
        setSession(result);
      } else {
        setPairError(result.error);
      }
    });
  }, [accountId]);

  // Poll the pairing session while we're on the pair step and have one.
  useEffect(() => {
    if (step !== "pair" || !session || expired) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      const res = await getDevicePairingStatus(session.sessionId);
      if (cancelled) return;
      if (res.ok) {
        const status: DevicePairingStatus = res.status;
        if (status === "consumed") {
          setDeviceCredentialId(res.deviceCredentialId);
          setStep("automate");
          return;
        }
        if (status === "expired" || status === "cancelled") {
          setExpired(true);
          return;
        }
      }
      if (Date.parse(session.expiresAt) <= Date.now()) {
        setExpired(true);
        return;
      }
      timer = setTimeout(tick, POLL_MS);
    };

    timer = setTimeout(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [step, session, expired]);

  const goPair = () => {
    setStep("pair");
    if (!session) beginPairing();
  };

  return (
    <div className="flex flex-col gap-6 pb-24">
      {step !== "done" && (
        <ol
          className="flex items-center gap-2 text-xs font-medium"
          aria-label="Setup progress"
        >
          {steps.map((label, i) => {
            const current = i === STEP_INDEX[step as Exclude<StepKey, "done">];
            const done = i < STEP_INDEX[step as Exclude<StepKey, "done">];
            return (
              <li
                key={label}
                aria-current={current ? "step" : undefined}
                className="flex items-center gap-2"
              >
                <span
                  className={`inline-flex h-6 w-6 items-center justify-center rounded-full border text-[11px] ${
                    done
                      ? "border-accent bg-accent text-accent-foreground"
                      : current
                      ? "border-accent text-accent"
                      : "border-border-strong text-text-muted"
                  }`}
                >
                  {done ? "✓" : i + 1}
                </span>
                <span
                  className={current ? "text-text-primary" : "text-text-muted"}
                >
                  {label}
                </span>
                {i < steps.length - 1 && (
                  <span aria-hidden className="text-text-muted">·</span>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {step === "service" && (
        <StepShell
          title="Set up this phone"
          hint="Pick the kind of phone and the account its transactions belong to."
        >
          <fieldset className="flex flex-col gap-1 text-sm">
            <legend className="mb-1 font-medium text-text-secondary">
              Phone type
            </legend>
            <div className="flex gap-2">
              {(["ios", "android"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  aria-pressed={platform === p}
                  onClick={() => setPlatform(p)}
                  className={`min-h-11 flex-1 rounded-control border px-3 text-sm font-medium ${
                    platform === p
                      ? "border-accent bg-accent text-accent-foreground"
                      : "border-border-strong text-text-secondary"
                  }`}
                >
                  {p === "ios" ? "iPhone" : "Android phone"}
                </button>
              ))}
            </div>
          </fieldset>

          {accounts.length === 0
            ? (
              <p className="text-sm text-text-muted">
                Add a financial account first —{" "}
                <Link
                  href="/settings/accounts"
                  className="font-medium text-accent hover:underline"
                >
                  Accounts
                </Link>
                .
              </p>
            )
            : (
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-text-secondary">Account</span>
                <select
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  className="min-h-11 rounded-control border border-border-strong bg-background px-3 py-2 text-base text-text-primary"
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </label>
            )}
        </StepShell>
      )}

      {step === "install" && (
        <StepShell
          title={isAndroid
            ? "Install the OneLedger Companion app"
            : "Add OneLedger Capture to this iPhone"}
          hint={isAndroid
            ? "A small app that forwards only supported transaction notifications. It never reads SMS and ignores everything else on the device."
            : "A small Shortcut that forwards supported transaction messages. It never shows you a link, a key, or code."}
        >
          {isAndroid
            ? <AndroidCompanionGuide companionUrl={androidCompanionUrl} />
            : shortcutUrl
            ? (
              <div className="flex flex-col gap-3 rounded-card border border-border-subtle bg-surface p-4">
                {captureShortcutUrl
                  ? (
                    <>
                      <p className="text-sm text-text-secondary">
                        Two small Shortcuts — add both:
                      </p>
                      <div className="flex items-center gap-2">
                        <a
                          href={shortcutUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => setConnectAdded(true)}
                          className={`inline-flex min-h-11 w-fit items-center rounded-control px-4 text-sm font-medium text-accent-foreground ${
                            connectAdded ? "bg-accent-pressed" : "bg-accent"
                          }`}
                        >
                          1. Add “Connect to OneLedger”
                        </a>
                        {connectAdded && (
                          <span className="inline-flex min-h-6 items-center rounded-full bg-accent-pressed/10 px-2 text-xs font-medium text-accent-pressed">
                            ✓ Added
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <a
                          href={captureShortcutUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => setCaptureAdded(true)}
                          className={`inline-flex min-h-11 w-fit items-center rounded-control px-4 text-sm font-medium text-accent-foreground ${
                            captureAdded
                              ? "bg-money-positive-pressed"
                              : "bg-money-positive"
                          }`}
                        >
                          2. Add “OneLedger Capture”
                        </a>
                        {captureAdded && (
                          <span className="inline-flex min-h-6 items-center rounded-full bg-money-positive-bg px-2 text-xs font-medium text-money-positive-pressed">
                            ✓ Added
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-text-secondary">
                        Each opens the Shortcuts app with a preview — scroll to
                        the bottom and tap{" "}
                        <span className="font-medium">Add Shortcut</span>. You
                        don’t need to open or edit either one.
                      </p>
                    </>
                  )
                  : (
                    <>
                      <a
                        href={shortcutUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-h-11 w-fit items-center rounded-control bg-accent px-4 text-sm font-medium text-accent-foreground"
                      >
                        Add the OneLedger Capture Shortcut
                      </a>
                      <p className="text-sm text-text-secondary">
                        Your iPhone opens the Shortcuts app and shows a
                        preview — scroll to the bottom and tap{" "}
                        <span className="font-medium">Add Shortcut</span>.
                        You’ll get two:{" "}
                        <span className="font-medium">Connect to OneLedger</span>
                        {" "}and{" "}
                        <span className="font-medium">OneLedger Capture</span>.
                        You don’t need to open or edit either one.
                      </p>
                    </>
                  )}
                <p className="text-xs text-text-muted">
                  Then tap <span className="font-medium">“I’ve added it”</span>
                  {" "}
                  below to pair this iPhone.
                </p>
              </div>
            )
            : (
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-2 rounded-card border border-border-subtle bg-surface p-4">
                  <p className="text-sm text-text-secondary">
                    The one-tap <span className="font-medium">OneLedger Capture</span>
                    {" "}
                    Shortcut for this iPhone hasn’t been published yet — guided
                    setup will be a single tap once it is.
                  </p>
                  <p className="text-sm text-text-secondary">
                    Already built the{" "}
                    <span className="font-medium">Connect to OneLedger</span> and
                    {" "}
                    <span className="font-medium">OneLedger Capture</span>{" "}
                    Shortcuts yourself? Tap{" "}
                    <span className="font-medium">“I’ve added it”</span> below to
                    pair this iPhone.
                  </p>
                </div>
                <p className="text-xs text-text-muted">
                  Rather set it up the long way?{" "}
                  <Link
                    href="/integrations/connections"
                    className="font-medium text-accent hover:underline"
                  >
                    Use an Advanced connection
                  </Link>
                  {" "}— a manual endpoint + key, no Shortcut.
                </p>
              </div>
            )}
        </StepShell>
      )}

      {step === "pair" && (
        <StepShell
          title={isAndroid ? "Pair this phone" : "Pair this iPhone"}
          hint="OneLedger and your phone swap a one-time code for a private key. You never type the key."
        >
          {pairError && (
            <div className="flex flex-col gap-2">
              <p role="alert" className="text-sm text-attention">{pairError}</p>
              {!session && !isStarting && (
                <button
                  type="button"
                  onClick={beginPairing}
                  className="min-h-11 w-fit rounded-control bg-accent px-4 text-sm font-medium text-accent-foreground"
                >
                  Try again
                </button>
              )}
            </div>
          )}

          {isStarting && !session && (
            <p className="text-sm text-text-secondary">Creating a secure code…</p>
          )}

          {session && !expired && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2 rounded-card border border-border-strong bg-surface p-4">
                <span className="text-xs font-medium uppercase tracking-wide text-text-muted">
                  Pairing code · expires in ~10 min
                </span>
                <code
                  className="block break-all text-lg font-semibold text-text-primary"
                  data-testid="pairing-code"
                >
                  {session.token}
                </code>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      if (!navigator.clipboard) throw new Error("no clipboard");
                      await navigator.clipboard.writeText(session.token);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    } catch {
                      // Clipboard blocked (older WebView / permissions) — the
                      // code is on screen to type by hand.
                      setCopied(false);
                    }
                  }}
                  aria-live="polite"
                  className="min-h-9 w-fit rounded-control bg-accent px-3 text-xs font-medium text-accent-foreground"
                >
                  {copied ? "Copied ✓" : "Copy code"}
                </button>
              </div>

              <a
                href={isAndroid
                  ? androidCompanionPairUrl(session.token)
                  : devicePairShortcutRunUrl(session.token)}
                className="inline-flex min-h-11 w-fit items-center rounded-control bg-accent px-4 text-sm font-medium text-accent-foreground"
              >
                {isAndroid
                  ? "Open in OneLedger Companion"
                  : "Open “Connect to OneLedger”"}
              </a>

              <p className="flex items-center gap-2 text-xs text-text-secondary">
                <span
                  aria-hidden
                  className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent"
                />
                Waiting for this phone to connect… this screen moves on by
                itself.
              </p>

              {handoffOrigin && (
                <div className="flex flex-col gap-2">
                  <QrCode
                    value={pairHandoffUrl(
                      handoffOrigin,
                      session.token,
                      platform,
                    )}
                    label="QR code to open pairing on your phone"
                    className="h-40 w-40 text-text-primary"
                  />
                  <p className="text-xs text-text-muted">
                    On a computer? Scan this with your phone&apos;s camera — or
                    open{" "}
                    <span className="font-medium">oneledger.me/pair</span>{" "}
                    on the phone and type the code.
                  </p>
                </div>
              )}
            </div>
          )}

          {expired && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-attention">
                This code expired before the phone connected.
              </p>
              <button
                type="button"
                onClick={beginPairing}
                disabled={isStarting}
                className="min-h-11 w-fit rounded-control bg-accent px-4 text-sm font-medium text-accent-foreground disabled:opacity-50"
              >
                {isStarting ? "Getting a new code…" : "Get a new code"}
              </button>
            </div>
          )}
        </StepShell>
      )}

      {step === "automate" && isAndroid && (
        <StepShell
          title="Allow notification access"
          hint="One system permission lets the Companion see supported transaction notifications. It’s the only manual step left."
        >
          <ol className="flex flex-col gap-3 text-sm text-text-secondary">
            <li>
              1. The Companion app shows a{" "}
              <span className="font-medium">Turn on notification access</span>
              {" "}
              button after pairing — tap it. (Or open{" "}
              <span className="font-medium">
                Settings → Notification access
              </span>{" "}
              yourself.)
            </li>
            <li>
              2. In the system list, find{" "}
              <span className="font-medium">OneLedger Companion</span> and turn
              it on. Confirm the Android prompt.
            </li>
            <li>
              3. Return to the Companion. It only ever forwards messages that
              match a supported provider — everything else stays on the phone.
            </li>
          </ol>
          <p className="rounded-control border border-border-subtle bg-surface p-3 text-xs text-text-muted">
            You can revoke this any time under Settings → Notification access.
            The Companion will show the connection as needing attention.
          </p>
        </StepShell>
      )}

      {step === "automate" && !isAndroid && (
        <StepShell
          title="Turn on transaction messages"
          hint="Apple needs you to allow this one automation. It’s the only manual step left."
        >
          <ol className="flex flex-col gap-3 text-sm text-text-secondary">
            <li>
              1. In <span className="font-medium">Shortcuts</span>, open the{" "}
              <span className="font-medium">Automation</span> tab and tap{" "}
              <span className="font-medium">+</span>.
            </li>
            <li>
              2. Choose <span className="font-medium">Message</span>. Leave
              {" "}
              <span className="font-medium">Sender</span> blank — MoMo texts
              show a generic network label, not a name you can reliably
              match. Instead, under{" "}
              <span className="font-medium">Message Contains</span>, type
              {" "}
              <code className="rounded bg-background px-1 py-0.5 text-xs">
                RWF
              </code>
              {" "}— it appears in every real MoMo or bank message. Set{" "}
              <span className="font-medium">Run Immediately</span> and turn
              notifications off.
            </li>
            <li>
              3. For the action, pick{" "}
              <span className="font-medium">Run Shortcut → OneLedger Capture</span>
              {" "}
              and pass the message as its input. Save.
            </li>
          </ol>
          <p className="rounded-control border border-border-subtle bg-surface p-3 text-xs text-text-muted">
            A message containing “RWF” that isn’t a real transaction is
            simply ignored — OneLedger only records ones it can actually
            parse.
            {mtnSender && (
              <>
                {" "}If your MoMo texts do show a stable sender, you can add
                {" "}
                <span className="font-medium">{mtnSender}</span> too for
                extra filtering.
              </>
            )}
          </p>
        </StepShell>
      )}

      {step === "verify" && (
        <StepShell
          title="Checking the connection"
          hint={isAndroid
            ? "The Companion sent a test the moment it paired. Otherwise, just wait for your next MoMo message."
            : "Run “Test OneLedger connection” from Shortcuts, or just wait for your next MoMo message."}
        >
          <ul className="flex flex-col gap-2 text-sm">
            <li className="text-money-positive">
              ✓ {isAndroid ? "Phone" : "iPhone"} paired
            </li>
            <li className="text-money-positive">✓ Secure connection established</li>
            {/* No static "waiting" line here on top of the probe - the probe
                itself is the live status (waiting / ready / gave-up) and was
                previously getting drowned out by a static bullet above it
                that never changed even once the connection went live. */}
            <li>
              {deviceCredentialId
                ? <ConnectionReadinessProbe credentialId={deviceCredentialId} />
                : (
                  <span className="text-text-secondary">
                    ○ Waiting for the first transaction message
                  </span>
                )}
            </li>
          </ul>
          <p className="text-xs text-text-muted">
            You can leave this — it keeps working in the background.
          </p>
        </StepShell>
      )}

      {step === "done" && (
        <div className="flex flex-col gap-3 rounded-card border border-border-subtle bg-surface p-6">
          <h2 className="text-base font-semibold text-text-primary">
            You’re all set
          </h2>
          <p className="text-sm text-text-secondary">
            Your {isAndroid ? "phone" : "iPhone"} is paired and sending
            supported transaction messages to OneLedger. There’s nothing else
            to configure — new transactions will appear here automatically
            from now on.
          </p>
          <Link
            href="/"
            className="inline-flex min-h-11 w-fit items-center rounded-control bg-accent px-4 text-sm font-medium text-accent-foreground"
          >
            Go to OneLedger
          </Link>
        </div>
      )}

      {step !== "done" && (
        <div className="sticky bottom-0 -mx-4 flex items-center justify-between gap-3 border-t border-border-subtle bg-background px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={() => {
              const order: StepKey[] = [
                "service",
                "install",
                "pair",
                "automate",
                "verify",
              ];
              const i = order.indexOf(step);
              if (i > 0) setStep(order[i - 1]);
            }}
            disabled={step === "service"}
            className="min-h-11 rounded-control px-3 text-sm font-medium text-text-muted disabled:opacity-40 hover:text-text-primary"
          >
            Back
          </button>

          <PrimaryNext
            step={step}
            hasAccount={Boolean(accountId)}
            onNext={() => {
              if (step === "service") setStep("install");
              else if (step === "install") goPair();
              else if (step === "automate") setStep("verify");
              else if (step === "verify") setStep("done");
            }}
          />
        </div>
      )}
    </div>
  );
}

function PrimaryNext({
  step,
  hasAccount,
  onNext,
}: {
  step: StepKey;
  hasAccount: boolean;
  onNext: () => void;
}) {
  // The pair step advances only from the poll, never a button.
  if (step === "pair") {
    return (
      <span className="text-xs text-text-muted">
        Continues automatically once paired
      </span>
    );
  }
  const label = step === "service"
    ? "Continue"
    : step === "install"
    ? "I’ve added it"
    : step === "automate"
    ? "I’ve set it up"
    : "Finish";
  return (
    <button
      type="button"
      onClick={onNext}
      disabled={step === "service" && !hasAccount}
      className="min-h-11 rounded-control bg-accent px-5 text-sm font-medium text-accent-foreground disabled:opacity-50"
    >
      {label}
    </button>
  );
}

function StepShell({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-text-primary">{title}</h2>
        <p className="text-sm text-text-secondary">{hint}</p>
      </div>
      {children}
    </section>
  );
}
