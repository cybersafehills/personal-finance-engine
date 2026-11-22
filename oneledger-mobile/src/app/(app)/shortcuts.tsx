import { ShortcutInstaller } from "@/features/ios-shortcuts/ShortcutInstaller";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { AppState, Linking, Platform, View } from "react-native";

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
  IOS_TROUBLESHOOTING,
  iosHealthDisplay,
  type IosDeviceStatus,
} from "@/features/ios-shortcuts/ios-health";
import {
  clearIosDeviceCredentialId,
  loadIosDeviceCredentialId,
  saveIosDeviceCredentialId,
} from "@/features/ios-shortcuts/store";
import {
  AUTOMATION_STEPS,
  CAPTURE_SHORTCUT_NAME,
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
  getDeviceStatus,
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
// no pairing session on the server and cannot claim a connected device.
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
    // Remember it so More can show this iPhone's health and the guide can
    // reopen at the check step instead of from the top.
    if (credentialId) saveIosDeviceCredentialId(credentialId);
    setStep("automate");
  }, []);

  // Coming back to a finished setup: resume at "check it works" when the
  // remembered connection is still active.
  useEffect(() => {
    let active = true;
    (async () => {
      const id = await loadIosDeviceCredentialId();
      if (!id) return;
      const status = await getDeviceStatus(id).catch(() => null);
      if (!active || status?.status !== "active") return;
      setDeviceCredentialId(id);
      setStep((current) => (current === "install" ? "verify" : current));
    })();
    return () => {
      active = false;
    };
  }, []);

  // "Connect again" (new iPhone, reinstalled Shortcuts): forget the old one.
  const handleReconnect = useCallback(() => {
    clearIosDeviceCredentialId();
    setDeviceCredentialId(null);
    setStep("connect");
  }, []);

  return (
    <Screen>
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
      {step === "verify" ? (
        <Verify deviceCredentialId={deviceCredentialId} onReconnect={handleReconnect} />
      ) : null}
    </Screen>
  );
}

function Install({ onNext }: { onNext: () => void }) {
  const hasLinks = config.connectShortcutUrl !== "";

  return (
    <>
      <Card style={{ gap: space[3] }}>
        <Text>
          iPhones don&apos;t let apps read your messages, so OneLedger uses two
          small Apple Shortcuts instead. You add them once.
        </Text>
        {hasLinks ? (
          <>
            <ShortcutInstaller connectUrl={config.connectShortcutUrl} captureUrl={config.captureShortcutUrl} open={open} />
            <Text variant="label" color="textMuted">
              Open each signed file in Shortcuts, tap Add Shortcut, then return here. If Apple asks to replace the old copy, choose Replace.
            </Text>
          </>
        ) : (
          <>
            <Text variant="label" color="textSecondary">
              Shortcut installation is unavailable in this build. Use the published web setup instead.
            </Text>
            <Button label="Open device setup on the web" variant="secondary" fullWidth onPress={() => open(`${config.apiBaseUrl}/integrations/connections/pair`)} />
          </>
        )}
      </Card>

      <Button
        label="I've added them"
        variant="primary"
        disabled={!hasLinks}
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
    }).catch(() => { if(active){setLoadError("Couldn’t load your accounts. Check your connection and try again.");setAccounts([]);} });
    return () => {
      active = false;
    };
  }, []);

  // While a code is live: poll whether the Shortcut redeemed it, and tick
  // the countdown. No return trip from the Shortcut is needed.
  useEffect(() => {
    if (!pairing) return;
    let active = true;
    const check = async () => {
      setNow(Date.now());
      if (Date.now() >= Date.parse(pairing.expiresAtIso)) return;
      const result = await getPairingSessionStatus(pairing.sessionId).catch(() => null);
      if (!active || !result) return;
      setStatus(result.status);
      if (result.status === "consumed") onConnected(result.deviceCredentialId);
    };
    const timer = setInterval(check, STATUS_POLL_MS);
    const subscription = AppState.addEventListener("change", (state) => { if (state === "active") void check(); });
    return () => {
      active = false;
      clearInterval(timer);
      subscription.remove();
    };
  }, [pairing, onConnected]);

  async function start() {
    const account = accounts?.find((a) => a.id === selectedId);
    if (!account || busy) return;
    setBusy(true);
    setError(null);
    if (PREVIEW_ONLY) { setBusy(false);setError("Open OneLedger on your iPhone to connect. This preview cannot connect a device.");return; }
    const started = await startPairingSession(account).catch(() => ({ok:false as const,message:"Couldn’t create a connection. Check your internet and try again."}));
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
              Passed securely as Shortcut Input when you open Connect below. Replace older copies of both Shortcuts before connecting.
            </Text>
          </View>
          <Button
            label="Open the Shortcut again"
            variant="secondary"
            fullWidth
            onPress={() => open(connectShortcutRunUrl(pairing.token))}
          />
          <Button label="Get a new code and connect" variant="ghost" loading={busy} onPress={start} />
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

function Verify({
  deviceCredentialId,
  onReconnect,
}: {
  deviceCredentialId: string | null;
  onReconnect: () => void;
}) {
  const [device, setDevice] = useState<IosDeviceStatus | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    if (!deviceCredentialId) return;
    let active = true;
    const check = async () => {
      const value = await getDeviceStatus(deviceCredentialId).catch(() => null);
      if (!active) return;
      setDevice(value);
      setNow(Date.now());
    };
    check();
    const timer = setInterval(check, VERIFY_POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [deviceCredentialId]);

  const working = device?.status === "active" && device.lastUsedAtIso !== null;
  const display = device ? iosHealthDisplay(device, now) : null;

  return (
    <>
      <Card style={{ gap: space[3] }}>
        {working && display ? (
          <>
            <Badge variant={display.variant}>{display.label}</Badge>
            <Text variant="heading">OneLedger can receive from this iPhone</Text>
            <Text variant="label" color="textSecondary">
              A connection test or message reached OneLedger. The next incoming MoMo message confirms that your Messages automation runs in the background.
            </Text>
            <Text variant="label" color="textSecondary">
              {display.detail} {device?.lastUsedAtIso ? `(${formatDateTime(device.lastUsedAtIso)})` : ""}
            </Text>
          </>
        ) : display && display.variant === "attention" ? (
          <>
            <Badge variant="attention">{display.label}</Badge>
            <Text>{display.detail}</Text>
          </>
        ) : (
          <>
            <Badge variant="neutral">Waiting for the first message</Badge>
            <Text>
              Your next MoMo message will confirm the Messages automation. No payment is needed just to finish setup.
            </Text>
            <Text variant="label" color="textMuted">
              This screen updates by itself. You can also leave: the
              transaction will appear in OneLedger within a few minutes.
            </Text>
          </>
        )}
      </Card>

      <Button label="Test connection without a payment" variant="secondary" fullWidth onPress={() => open(`shortcuts://run-shortcut?name=${encodeURIComponent(CAPTURE_SHORTCUT_NAME)}`)} />
      <Card style={{ gap: space[3] }}>
        <Button
          label={showHelp ? "Hide troubleshooting" : "It isn't working"}
          variant="ghost"
          onPress={() => setShowHelp((v) => !v)}
        />
        {showHelp ? (
          <View style={{ gap: space[3] }}>
            {IOS_TROUBLESHOOTING.map((item) => (
              <View key={item.problem} style={{ gap: 2 }}>
                <Text variant="bodyStrong">{item.problem}</Text>
                <Text variant="label" color="textSecondary">
                  {item.fix}
                </Text>
              </View>
            ))}
            <Button
              label="Open Shortcuts"
              variant="secondary"
              fullWidth
              onPress={() => open(SHORTCUTS_APP_URL)}
            />
          </View>
        ) : null}
      </Card>

      <Button label="Finish" fullWidth onPress={() => router.back()} />
      <Button label="Connect this iPhone again" variant="ghost" fullWidth onPress={onReconnect} />
    </>
  );
}
