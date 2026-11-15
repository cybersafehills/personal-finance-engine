import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Linking, Platform, View } from "react-native";

import {
  Badge,
  Button,
  Card,
  EmptyState,
  Screen,
  StepWizard,
  Text,
} from "@/components/ds";
import {
  AUTOMATION_STEPS,
  connectPhase,
  connectShortcutRunUrl,
  expiryLabel,
  IOS_GUIDE_STEPS,
  iosGuideStepNumber,
  SHORTCUTS_APP_URL,
  type IosGuideStep,
  type PairingStatus,
} from "@/features/ios-shortcuts/shortcuts";
import { AccountPicker } from "@/features/pairing/AccountPicker";
import {
  getDeviceLastUsedAt,
  getPairingSessionStatus,
  listPairableAccounts,
  startPairingSession,
  type PairableAccount,
  type StartedPairing,
} from "@/features/pairing/pairing";
import { config } from "@/lib/config";
import { formatDateTime } from "@/lib/kigali-time";
import { space } from "@/theme/tokens";

// Anywhere but a real iPhone this screen is a walkthrough only: it creates
// no pairing session on the server and simulates the Shortcut's part.
const PREVIEW_ONLY = Platform.OS !== "ios";

const STATUS_POLL_MS = 3_000;
const VERIFY_POLL_MS = 5_000;

/** Opens a URL, reporting failure instead of throwing (e.g. app not installed). */
async function open(url: string): Promise<boolean> {
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}

// The iPhone setup guide (ADR 0019 §9): add the two Shortcuts, connect,
// create the Messages automation, then confirm messages arrive.
export default function ShortcutsGuide() {
  const [step, setStep] = useState<IosGuideStep>("install");
  const [deviceCredentialId, setDeviceCredentialId] = useState<string | null>(null);
  const title = IOS_GUIDE_STEPS.find((s) => s.key === step)?.title ?? "";

  // Stable identity: the connect step's polling effect depends on it, and
  // would otherwise restart on every countdown tick.
  const handleConnected = useCallback((credentialId: string | null) => {
    setDeviceCredentialId(credentialId);
    setStep("automate");
  }, []);

  return (
    <Screen>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text variant="label" color="textMuted">
          Record MoMo on iPhone
        </Text>
        <Button label="Close" variant="ghost" onPress={() => router.back()} />
      </View>
      {PREVIEW_ONLY ? (
        <Badge variant="attention">Walkthrough only: this isn&apos;t an iPhone</Badge>
      ) : null}

      <StepWizard
        current={iosGuideStepNumber(step)}
        total={IOS_GUIDE_STEPS.length}
        title={title}
      />

      {step === "install" ? <Install onNext={() => setStep("connect")} /> : null}
      {step === "connect" ? (
        <Connect onConnected={handleConnected} />
      ) : null}
      {step === "automate" ? <Automate onNext={() => setStep("verify")} /> : null}
      {step === "verify" ? <Verify deviceCredentialId={deviceCredentialId} /> : null}
    </Screen>
  );
}

function Install({ onNext }: { onNext: () => void }) {
  const [failed, setFailed] = useState(false);
  const hasLinks = config.connectShortcutUrl !== "";

  async function add(url: string) {
    setFailed(!(await open(url)));
  }

  return (
    <>
      <Card style={{ gap: space[3] }}>
        <Text>
          iPhones don&apos;t let apps read your messages, so OneLedger uses two
          small Apple Shortcuts instead. You add them once.
        </Text>
        {hasLinks ? (
          <>
            <Button
              label={
                config.captureShortcutUrl
                  ? "Add “Connect to OneLedger”"
                  : "Add the OneLedger Shortcuts"
              }
              fullWidth
              onPress={() => add(config.connectShortcutUrl)}
            />
            {config.captureShortcutUrl ? (
              <Button
                label="Add “OneLedger Capture”"
                fullWidth
                onPress={() => add(config.captureShortcutUrl)}
              />
            ) : null}
            <Text variant="label" color="textMuted">
              Each one opens in the Shortcuts app. Tap Add Shortcut, then come
              back here.
            </Text>
          </>
        ) : (
          <Text variant="label" color="attention">
            One-tap setup isn&apos;t available yet. The Shortcuts haven&apos;t
            been published, so there is nothing to add from here for now.
          </Text>
        )}
        {failed ? (
          <Text variant="label" color="attention" accessibilityRole="alert">
            Couldn&apos;t open that link. Make sure the Shortcuts app is
            installed.
          </Text>
        ) : null}
      </Card>
      <Button
        label={hasLinks ? "I've added them" : "Continue anyway"}
        variant={hasLinks ? "primary" : "secondary"}
        fullWidth
        onPress={onNext}
      />
    </>
  );
}

function Connect({ onConnected }: { onConnected: (credentialId: string | null) => void }) {
  const [accounts, setAccounts] = useState<PairableAccount[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pairing, setPairing] = useState<StartedPairing | null>(null);
  const [status, setStatus] = useState<PairingStatus | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let active = true;
    listPairableAccounts().then((result) => {
      if (!active) return;
      if (!result.ok) {
        setLoadError(result.message);
        setAccounts([]);
        return;
      }
      setAccounts(result.accounts);
      setSelectedId(result.accounts[0]?.id ?? null);
    });
    return () => {
      active = false;
    };
  }, []);

  // While a code is live: poll whether the Shortcut redeemed it, and tick
  // the countdown. No return trip from the Shortcut is needed.
  useEffect(() => {
    if (!pairing) return;
    let active = true;
    let polls = 0;
    const timer = setInterval(async () => {
      setNow(Date.now());
      polls += 1;
      if (PREVIEW_ONLY) {
        if (polls >= 2 && active) onConnected(null);
        return;
      }
      const result = await getPairingSessionStatus(pairing.sessionId);
      if (!active || !result) return;
      setStatus(result.status);
      if (result.status === "consumed") onConnected(result.deviceCredentialId);
    }, STATUS_POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [pairing, onConnected]);

  async function start() {
    const account = accounts?.find((a) => a.id === selectedId);
    if (!account || busy) return;
    setBusy(true);
    setError(null);
    const started = PREVIEW_ONLY
      ? ({
          ok: true,
          token: "olp_DEMO-walkthrough-only",
          sessionId: "demo",
          expiresAtIso: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        } as const)
      : await startPairingSession(account);
    setBusy(false);
    if (!started.ok) {
      setError(started.message);
      return;
    }
    setStatus("pending");
    setNow(Date.now());
    setPairing(started);
    if (!PREVIEW_ONLY && !(await open(connectShortcutRunUrl(started.token)))) {
      setError(
        "Couldn't open the Shortcut. Check that “Connect to OneLedger” is added, then tap the button below.",
      );
    }
  }

  if (accounts === null) return null;

  if (accounts.length === 0) {
    return (
      <EmptyState
        variant="setup"
        title={loadError ?? "No MTN MoMo account yet"}
        description={
          loadError
            ? undefined
            : "Add your MTN MoMo account in OneLedger on the web first, then come back here."
        }
      />
    );
  }

  const phase = pairing ? connectPhase(status, pairing.expiresAtIso, now) : null;

  if (pairing && phase === "waiting") {
    return (
      <>
        <Card style={{ gap: space[3] }}>
          <Text>
            The Shortcut should open and ask to connect. Allow it, then come
            back here. This screen moves on by itself.
          </Text>
          <View style={{ gap: 2 }}>
            <Text variant="caption" color="textMuted">
              Your one-time code ({expiryLabel(pairing.expiresAtIso, now)})
            </Text>
            <Text variant="bodyStrong" selectable>
              {pairing.token}
            </Text>
            <Text variant="caption" color="textMuted">
              Only needed if the Shortcut asks you to type it.
            </Text>
          </View>
          <Button
            label="Open the Shortcut again"
            variant="secondary"
            fullWidth
            onPress={() => open(connectShortcutRunUrl(pairing.token))}
          />
          <Text variant="label" color="textMuted">
            Waiting for this iPhone to connect…
          </Text>
        </Card>
        {error ? (
          <Text variant="label" color="attention" accessibilityRole="alert">
            {error}
          </Text>
        ) : null}
      </>
    );
  }

  return (
    <>
      {phase === "expired" ? (
        <Card>
          <Text variant="label" color="attention">
            That code expired before it was used. Get a new one below.
          </Text>
        </Card>
      ) : null}
      <Card style={{ gap: space[3] }}>
        <Text variant="label" color="textSecondary">
          Which account do this iPhone&apos;s MoMo messages belong to?
        </Text>
        <AccountPicker accounts={accounts} selectedId={selectedId} onSelect={setSelectedId} />
        <Button
          label={phase === "expired" ? "Get a new code and connect" : "Connect this iPhone"}
          fullWidth
          loading={busy}
          disabled={!selectedId}
          onPress={start}
        />
      </Card>
      {error ? (
        <Text variant="label" color="attention" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </>
  );
}

function Automate({ onNext }: { onNext: () => void }) {
  return (
    <>
      <Card style={{ gap: space[3] }}>
        <Text>
          This iPhone is connected. Last step in Apple&apos;s Shortcuts app:
          tell it to pass MoMo messages to OneLedger. Apple requires you to
          set this up yourself.
        </Text>
        {AUTOMATION_STEPS.map((text, index) => (
          <View key={text} style={{ flexDirection: "row", gap: space[2] }}>
            <Text variant="bodyStrong" color="accent">
              {index + 1}.
            </Text>
            <Text variant="label" color="textSecondary" style={{ flex: 1 }}>
              {text}
            </Text>
          </View>
        ))}
        <Text variant="label" color="textMuted">
          “RWF” appears in every MoMo message. Anything else that happens to
          contain it is ignored by OneLedger and never recorded.
        </Text>
        <Button
          label="Open Shortcuts"
          variant="secondary"
          fullWidth
          onPress={() => open(SHORTCUTS_APP_URL)}
        />
      </Card>
      <Button label="I've done this" fullWidth onPress={onNext} />
    </>
  );
}

function Verify({ deviceCredentialId }: { deviceCredentialId: string | null }) {
  const [lastUsedAt, setLastUsedAt] = useState<string | null>(null);

  useEffect(() => {
    if (!deviceCredentialId) return;
    let active = true;
    const check = async () => {
      const value = await getDeviceLastUsedAt(deviceCredentialId);
      if (active) setLastUsedAt(value);
    };
    check();
    const timer = setInterval(check, VERIFY_POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [deviceCredentialId]);

  return (
    <>
      <Card style={{ gap: space[3] }}>
        {lastUsedAt ? (
          <>
            <Badge variant="positive">Working</Badge>
            <Text variant="heading">OneLedger is receiving from this iPhone</Text>
            <Text variant="label" color="textSecondary">
              Last heard from it: {formatDateTime(lastUsedAt)}.
            </Text>
          </>
        ) : (
          <>
            <Badge variant="neutral">Waiting for the first message</Badge>
            <Text>
              Your next MoMo message will confirm it. To check now, make a
              small MoMo payment or ask someone to send you a little.
            </Text>
            <Text variant="label" color="textMuted">
              This screen updates by itself. You can also leave: the
              transaction will appear in OneLedger within a few minutes.
            </Text>
          </>
        )}
      </Card>
      <Button label="Finish" fullWidth onPress={() => router.back()} />
    </>
  );
}
