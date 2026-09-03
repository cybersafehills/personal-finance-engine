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
  captureShortcutGuideSteps,
  CAPTURE_SHORTCUT_TROUBLESHOOTING,
} from "../lib/capture-shortcut-guide";
import {
  deviceCaptureShortcutRunUrl,
  pairHandoffUrl,
} from "../lib/pairing";
import { QrCode } from "./QrCode";
import { ShortcutGuide } from "./ShortcutGuide";
import { ConnectionReadinessProbe } from "./ConnectionReadinessProbe";
import {
  type DevicePairingStatus,
  getDevicePairingStatus,
  startDevicePairing,
  type StartDevicePairingResult,
} from "../app/integrations/connections/pair/actions";

type Session = Extract<StartDevicePairingResult, { ok: true }>;

const STEPS = ["Account", "Install", "Pair", "Automate", "Verify"] as const;
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
  mtnSender,
}: {
  accounts: AccountRow[];
  shortcutUrl: string | null;
  mtnSender: string | null;
}) {
  const [step, setStep] = useState<StepKey>("service");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [session, setSession] = useState<Session | null>(null);
  const [deviceCredentialId, setDeviceCredentialId] = useState<string | null>(
    null,
  );
  const [pairError, setPairError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
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
          {STEPS.map((label, i) => {
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
                {i < STEPS.length - 1 && (
                  <span aria-hidden className="text-text-muted">·</span>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {step === "service" && (
        <StepShell
          title="Which account does this iPhone feed?"
          hint="Transactions this phone captures will be recorded against this account."
        >
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
          title="Add OneLedger Capture to this iPhone"
          hint="A small Shortcut that forwards supported transaction messages. It never shows you a link, a key, or code."
        >
          <ShortcutGuide
            steps={captureShortcutGuideSteps({ shortcutUrl, mtnSender })}
            troubleshooting={CAPTURE_SHORTCUT_TROUBLESHOOTING}
            shortcutUrl={shortcutUrl}
          />
        </StepShell>
      )}

      {step === "pair" && (
        <StepShell
          title="Pair this iPhone"
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
                <code className="block break-all text-lg font-semibold text-text-primary">
                  {session.token}
                </code>
                <button
                  type="button"
                  onClick={() => navigator.clipboard?.writeText(session.token)}
                  className="min-h-9 w-fit rounded-control bg-accent px-3 text-xs font-medium text-accent-foreground"
                >
                  Copy code
                </button>
              </div>

              <a
                href={deviceCaptureShortcutRunUrl(session.token)}
                className="inline-flex min-h-11 w-fit items-center rounded-control bg-accent px-4 text-sm font-medium text-accent-foreground"
              >
                Open OneLedger Capture
              </a>

              <p className="flex items-center gap-2 text-xs text-text-secondary">
                <span
                  aria-hidden
                  className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent"
                />
                Waiting for this iPhone to connect… this screen moves on by
                itself.
              </p>

              {handoffOrigin && (
                <div className="flex flex-col gap-2">
                  <QrCode
                    value={pairHandoffUrl(handoffOrigin, session.token)}
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

      {step === "automate" && (
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
              2. Choose <span className="font-medium">Message</span>. Under
              Sender, add{" "}
              <code className="rounded bg-background px-1 py-0.5 text-xs">
                {mtnSender ?? "<the sender your MoMo messages come from>"}
              </code>
              . Set <span className="font-medium">Run Immediately</span> and turn
              notifications off.
            </li>
            <li>
              3. For the action, pick{" "}
              <span className="font-medium">Run Shortcut → OneLedger Capture</span>
              {" "}
              and pass the message as its input. Save.
            </li>
          </ol>
          {!mtnSender && (
            <p className="rounded-control border border-border-subtle bg-surface p-3 text-xs text-text-muted">
              Use whatever name MoMo messages actually arrive from on your phone.
            </p>
          )}
        </StepShell>
      )}

      {step === "verify" && (
        <StepShell
          title="Checking the connection"
          hint="Run “Test OneLedger connection” from Shortcuts, or just wait for your next MoMo message."
        >
          <ul className="flex flex-col gap-2 text-sm">
            <li className="text-money-positive">✓ iPhone paired</li>
            <li className="text-money-positive">✓ Secure connection established</li>
            <li className="flex flex-col gap-1 text-text-secondary">
              <span>○ Waiting for the first transaction message</span>
              {deviceCredentialId && (
                <ConnectionReadinessProbe credentialId={deviceCredentialId} />
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
            Your iPhone is connected
          </h2>
          <p className="text-sm text-text-secondary">
            Supported transaction messages from this phone are now recorded in
            OneLedger automatically.
          </p>
          <Link
            href="/integrations/connections"
            className="inline-flex min-h-11 w-fit items-center rounded-control bg-accent px-4 text-sm font-medium text-accent-foreground"
          >
            Done
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
