import { AutomationGuide } from "@/features/ios-shortcuts/AutomationGuide";
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
  CAPTURE_SHORTCUT_NAME,
  CONNECT_SHORTCUT_NAME,
  captureTestRunUrl,
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
  getShortcutDeliveryStatus,
  type ShortcutDeliveryStatus,
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
        title={step === "install" && config.combinedShortcutUrl ? "Add OneLedger Capture" : title}
      />

      {step === "install" ? <Install onNext={() => setStep("connect")} /> : null}
      {step === "connect" ? (
        <Connect onConnected={handleConnected} />
      ) : null}
      {step === "automate" ? <Automate onNext={() => setStep("verify")} /> : null}
      {step === "verify" ? (
        <Verify deviceCredentialId={deviceCredentialId} onReconnect={handleReconnect} onUpdate={() => setStep("install")} onReview={() => setStep("automate")} />
      ) : null}
    </Screen>
  );
}

function Install({ onNext }: { onNext: () => void }) {
  const single = !!config.combinedShortcutUrl;
  const hasLinks = single || config.connectShortcutUrl !== "";

  return (
    <>
      <Card style={{ gap: space[3] }}>
        <Text color="textSecondary">Add in Apple’s preview, then return here. OneLedger will check the connection in the next step.</Text>
        {hasLinks ? (
          <>
            <ShortcutInstaller single={single} connectUrl={single ? config.combinedShortcutUrl : config.connectShortcutUrl} captureUrl={config.captureShortcutUrl} open={open} />

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
        label={single ? "I’ve added OneLedger Capture" : "I've added them"}
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
    if (!PREVIEW_ONLY && !(await open(connectShortcutRunUrl(started.token, config.combinedShortcutUrl ? CAPTURE_SHORTCUT_NAME : CONNECT_SHORTCUT_NAME)))) {
      setError(
        "Couldn't open the Shortcut. Check that the shortcut shown in step 1 is installed, then tap the button below.",
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
              Passed securely as Shortcut Input when you open Connect below. Install the current shortcut before connecting.
            </Text>
          </View>
          <Button
            label="Open the Shortcut again"
            variant="secondary"
            fullWidth
            onPress={() => open(connectShortcutRunUrl(pairing.token, config.combinedShortcutUrl ? CAPTURE_SHORTCUT_NAME : CONNECT_SHORTCUT_NAME))}
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
  return <><Badge variant="positive">This iPhone is connected</Badge><AutomationGuide onNext={onNext} /></>;
}

function Verify({
  deviceCredentialId,
  onReconnect,
  onUpdate,
  onReview,
}: {
  deviceCredentialId: string | null;
  onReconnect: () => void;
  onUpdate: () => void;
  onReview: () => void;
}) {
  const [device, setDevice] = useState<IosDeviceStatus | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [showHelp, setShowHelp] = useState(false);
  const [delivery, setDelivery] = useState<ShortcutDeliveryStatus | null>(null);
  const [testStartedAt, setTestStartedAt] = useState<number | null>(null);
  const [testOpenError, setTestOpenError] = useState(false);

  useEffect(() => {
    if (!deviceCredentialId) return;
    let active = true;
    const check = async () => {
      const [value, evidence] = await Promise.all([getDeviceStatus(deviceCredentialId).catch(() => null), getShortcutDeliveryStatus(deviceCredentialId).catch(() => null)]);
      if (!active) return;
      setDevice(value);
      setDelivery(evidence);
      setNow(Date.now());
    };
    check();
    const timer = setInterval(check, VERIFY_POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [deviceCredentialId]);

  const activityAt = delivery?.testAt ? Date.parse(delivery.testAt) : NaN;
  const working = device?.status === "active" && testStartedAt !== null && Number.isFinite(activityAt) && activityAt >= testStartedAt;
  async function testConnection() {
    setTestStartedAt(Date.now());
    setTestOpenError(false);
    if (!(await open(captureTestRunUrl()))) setTestOpenError(true);
  }
  const display = device ? iosHealthDisplay(device, now) : null;

  return (
    <>
      <Card style={{ gap: space[3] }}>
        {working && display ? (
          <>
            <Badge variant="positive">Connection test received</Badge>
            <Text variant="heading">OneLedger can receive from this iPhone</Text>
            <Text variant="label" color="textSecondary">
              OneLedger confirmed a successful test after you started it. This checks the connection only. A real incoming MoMo message is still needed to confirm background forwarding.
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
            <Badge variant="neutral">{testStartedAt ? "Waiting for a fresh test" : "Connection not verified this visit"}</Badge>
            <Text>
              Run the connection test below. Previous activity does not verify this setup. No payment is needed for this test.
            </Text>
            <Text variant="label" color="textMuted">
              This screen updates when a fresh response arrives. If Shortcuts reports an error, the connection has not passed this test.
            </Text>
          </>
        )}
      </Card>

      <Button label="Test connection without a payment" variant="secondary" fullWidth onPress={() => void testConnection()} />
      {testStartedAt && delivery?.rejection && Date.parse(delivery.rejection.created_at) >= testStartedAt && !working ? <Text accessibilityRole="alert" color="attention">The latest request was rejected ({delivery.rejection.reason_code ?? "unknown error"}). Update OneLedger Capture and retry. Pairing alone does not confirm recording.</Text> : null}
      {testOpenError ? <Text accessibilityRole="alert" color="attention">Couldn’t open the test. Check that the current OneLedger Capture is installed.</Text> : null}
      {testStartedAt && !working && now - testStartedAt > 60_000 ? <Text accessibilityRole="alert" color="attention">No fresh test response yet. Update OneLedger Capture and check the error shown in Shortcuts.</Text> : null}
      <Button label="Review forwarding instructions" variant="ghost" onPress={onReview} />
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
      <Button label="Update or reinstall OneLedger Capture" variant="secondary" fullWidth onPress={onUpdate} />
      <Button label="Connect this iPhone again" variant="ghost" fullWidth onPress={onReconnect} />
    </>
  );
}
