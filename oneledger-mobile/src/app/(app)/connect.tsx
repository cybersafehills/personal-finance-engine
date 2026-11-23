import { GuideAnchor } from "@/features/guides/GuideAnchor";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
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
  TextField,
} from "@/components/ds";
import {
  captureIsDemo,
  captureSupported,
  getCaptureHealth,
  openNotificationAccessSettings,
  pairDevice,
  sendCaptureTest,
  type CaptureHealth,
} from "@/features/capture/capture";
import { AccountPicker } from "@/features/pairing/AccountPicker";
import {
  CONNECT_STEPS,
  connectStepNumber,
  currentConnectStep,
} from "@/features/pairing/connect-steps";
import {
  connectThisPhone,
  listPairableAccounts,
  type PairableAccount,
} from "@/features/pairing/pairing";
import { config } from "@/lib/config";
import { deviceStore } from "@/lib/device-store";
import { space } from "@/theme/tokens";

const KEEP_RUNNING_SEEN_KEY = "connect.keepRunningSeen";

// Guided setup for automatic recording. The step shown is derived from the
// capture engine's real state (see connect-steps.ts), so the flow resumes
// correctly after a trip to system settings or an app restart.
export default function Connect() {
  // A code from a deep link (oneledger://pair?c=...) or the web wizard.
  const { code } = useLocalSearchParams<{ code?: string }>();

  const [health, setHealth] = useState<CaptureHealth | null>(null);
  const [disclosureAccepted, setDisclosureAccepted] = useState(false);
  const [keepRunningSeen, setKeepRunningSeen] = useState(false);

  const refresh = useCallback(async () => {
    const [next, seen] = await Promise.all([
      getCaptureHealth(),
      deviceStore.get(KEEP_RUNNING_SEEN_KEY),
    ]);
    setHealth(next);
    setKeepRunningSeen(seen === "1");
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );
  // Coming back from system settings is the moment access may have changed.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  if (!captureSupported) {
    return (
      <Screen edges={["top", "left", "right", "bottom"]}>
        <Header />
        <EmptyState
          variant="setup"
          title={Platform.OS === "ios" ? "iPhone uses a Shortcut" : "Not available on this device"}
          description={
            Platform.OS === "ios"
              ? "iPhones don't let apps read notifications, so OneLedger records MoMo messages with an Apple Shortcut instead."
              : "Automatic recording works on Android phones and, with a Shortcut, on iPhone."
          }
          action={
            Platform.OS === "ios" ? (
              <Button label="Set up on iPhone" onPress={() => router.replace("/shortcuts")} />
            ) : undefined
          }
        />
      </Screen>
    );
  }
  if (!health) {
    return (
      <Screen edges={["top", "left", "right", "bottom"]}>
        <Header />
      </Screen>
    );
  }

  const step = currentConnectStep(health, { disclosureAccepted, keepRunningSeen });
  const stepTitle =
    CONNECT_STEPS.find((s) => s.key === step)?.title ?? "All set";

  return (
    <Screen edges={["top", "left", "right", "bottom"]}>
      <Header />
      {captureIsDemo ? (
        <Badge variant="attention">Preview demo: nothing is really connected</Badge>
      ) : null}

      {step !== "done" ? (
        <StepWizard
          current={connectStepNumber(step)}
          total={CONNECT_STEPS.length}
          title={stepTitle}
        />
      ) : null}

      {step === "disclosure" ? (
        <Disclosure onAccept={() => setDisclosureAccepted(true)} />
      ) : null}
      {step === "connect" ? (
        <ConnectStepCard
          initialCode={code}
          reconnecting={health.state === "reauthentication_required"}
          onConnected={refresh}
        />
      ) : null}
      {step === "allow_access" ? <AllowAccess onCheck={refresh} /> : null}
      {step === "keep_running" ? (
        <KeepRunning
          onDone={async () => {
            await deviceStore.set(KEEP_RUNNING_SEEN_KEY, "1");
            refresh();
          }}
        />
      ) : null}
      {step === "done" ? <Done health={health} /> : null}
    </Screen>
  );
}

function Header() {
  return (
    <GuideAnchor id="recording-page"><View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      <Text variant="label" color="textMuted">
        Record MoMo automatically
      </Text>
      <Button label="Close" variant="ghost" onPress={() => router.back()} />
    </View></GuideAnchor>
  );
}

/**
 * Shown BEFORE anything is enabled (Play "prominent disclosure"): what is
 * read, what leaves the phone, and what does not.
 */
function Disclosure({ onAccept }: { onAccept: () => void }) {
  return (
    <>
      <Card style={{ gap: space[3] }}>
        <Text>
          OneLedger can record your MTN MoMo transactions for you, so you
          don&apos;t have to type them in.
        </Text>
        <Point
          title="What it reads"
          body="The notifications that appear on this phone, to find MoMo transaction messages."
        />
        <Point
          title="What is sent to OneLedger"
          body="Only messages it recognises as MoMo transactions: the message text and the time it arrived. They are added to your account."
        />
        <Point
          title="What stays on your phone"
          body="Everything else. Other notifications are ignored straight away: not saved, not sent. OneLedger does not read your SMS inbox."
        />
        <Text variant="label" color="textMuted">
          You can turn this off at any time in your phone&apos;s settings or
          here in the app.
        </Text>
      </Card>
      <Button label="I agree, continue" fullWidth onPress={onAccept} />
      <Button
        label="Not now"
        variant="ghost"
        fullWidth
        onPress={() => router.back()}
      />
    </>
  );
}

function Point({ title, body }: { title: string; body: string }) {
  return (
    <View style={{ gap: 2 }}>
      <Text variant="bodyStrong">{title}</Text>
      <Text variant="label" color="textSecondary">
        {body}
      </Text>
    </View>
  );
}

function ConnectStepCard({
  initialCode,
  reconnecting,
  onConnected,
}: {
  initialCode?: string;
  reconnecting: boolean;
  onConnected: () => void;
}) {
  const [accounts, setAccounts] = useState<PairableAccount[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCode, setShowCode] = useState(!!initialCode);
  const [codeInput, setCodeInput] = useState(initialCode ?? "");

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

  async function connect() {
    const account = accounts?.find((a) => a.id === selectedId);
    if (!account || busy) return;
    setBusy(true);
    setError(null);
    const result = await connectThisPhone(account);
    setBusy(false);
    if (!result.ok) setError(result.message);
    else onConnected();
  }

  async function connectWithCode() {
    if (busy) return;
    if (!codeInput.trim()) {
      setError("Enter the code shown in OneLedger on the web.");
      return;
    }
    setBusy(true);
    setError(null);
    const result = await pairDevice(codeInput.trim());
    setBusy(false);
    if (!result.ok) setError(result.message);
    else onConnected();
  }

  return (
    <>
      {reconnecting ? (
        <Card>
          <Text variant="label" color="attention">
            This phone was disconnected from OneLedger. Connect it again to
            carry on recording.
          </Text>
        </Card>
      ) : null}

      {accounts === null ? null : accounts.length === 0 ? (
        <EmptyState
          variant="setup"
          title={loadError ?? "No MTN MoMo account yet"}
          description={
            loadError
              ? undefined
              : "Add your MTN MoMo account in OneLedger on the web first, then come back here."
          }
          action={
            !loadError && config.apiBaseUrl ? (
              <Button
                label="Open OneLedger on the web"
                variant="secondary"
                onPress={() =>
                  Linking.openURL(`${config.apiBaseUrl}/settings/accounts`)
                }
              />
            ) : undefined
          }
        />
      ) : (
        <Card style={{ gap: space[3] }}>
          <Text variant="label" color="textSecondary">
            Which account do this phone&apos;s MoMo messages belong to?
          </Text>
          <AccountPicker
            accounts={accounts}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
          <Button
            label="Connect this phone"
            fullWidth
            loading={busy && !showCode}
            disabled={!selectedId}
            onPress={connect}
          />
        </Card>
      )}

      {showCode ? (
        <Card style={{ gap: space[3] }}>
          <TextField
            label="Code from OneLedger on the web"
            value={codeInput}
            onChangeText={setCodeInput}
            autoCapitalize="none"
            autoCorrect={false}
            help="Starts with olp_. You can also paste the whole link."
          />
          <Button
            label="Connect with this code"
            variant="secondary"
            fullWidth
            loading={busy}
            onPress={connectWithCode}
          />
        </Card>
      ) : (
        <Button
          label="I have a code from the web"
          variant="ghost"
          fullWidth
          onPress={() => setShowCode(true)}
        />
      )}

      {error ? (
        <Text variant="label" color="attention" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </>
  );
}

function AllowAccess({ onCheck }: { onCheck: () => void }) {
  const [showHelp, setShowHelp] = useState(false);
  return (
    <>
      <Card style={{ gap: space[3] }}>
        <Text>
          Your phone is connected. Now let OneLedger see notifications, so it
          can spot MoMo messages.
        </Text>
        <Numbered n={1} text="Tap the button below. Your phone's settings will open." />
        <Numbered n={2} text="Find OneLedger in the list and switch it on." />
        <Numbered n={3} text="Tap Allow, then come back to this app." />
        <Button
          label="Open notification settings"
          fullWidth
          onPress={() => {
            openNotificationAccessSettings();
            // The web demo flips the switch immediately; real phones refresh
            // when the app returns to the foreground.
            if (captureIsDemo) onCheck();
          }}
        />
      </Card>

      <Button
        label={showHelp ? "Hide help" : "The switch is greyed out"}
        variant="ghost"
        fullWidth
        onPress={() => setShowHelp((shown) => !shown)}
      />
      {showHelp ? (
        <Card style={{ gap: space[3] }}>
          <Text variant="label" color="textSecondary">
            Newer Android versions block this switch for apps that were not
            installed from the Play Store, until you allow it once:
          </Text>
          <Numbered n={1} text="Open the app's settings page with the button below." />
          <Numbered n={2} text="Tap the three dots in the top-right corner." />
          <Numbered n={3} text="Tap Allow restricted settings and confirm." />
          <Numbered n={4} text="Come back here and open notification settings again." />
          <Button
            label="Open app settings"
            variant="secondary"
            fullWidth
            onPress={() => Linking.openSettings()}
          />
        </Card>
      ) : null}
    </>
  );
}

function KeepRunning({ onDone }: { onDone: () => void }) {
  return (
    <>
      <Card style={{ gap: space[3] }}>
        <Text>
          Some phones stop apps in the background to save battery. That would
          make OneLedger miss messages while you&apos;re not using it.
        </Text>
        <Numbered n={1} text="Open the app's settings page with the button below." />
        <Numbered n={2} text="Tap Battery (or App battery usage)." />
        <Numbered n={3} text="Choose Unrestricted (or No restrictions)." />
        <Text variant="label" color="textMuted">
          On Tecno, Infinix, itel, Xiaomi and similar phones, also turn on
          Auto-start (or Auto-launch) for OneLedger if you see it.
        </Text>
        {Platform.OS !== "web" ? (
          <Button
            label="Open app settings"
            variant="secondary"
            fullWidth
            onPress={() => Linking.openSettings()}
          />
        ) : null}
      </Card>
      <Button label="Done" fullWidth onPress={onDone} />
    </>
  );
}

function Done({ health }: { health: CaptureHealth }) {
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function test() {
    setBusy(true);
    const result = await sendCaptureTest();
    setBusy(false);
    setNotice(
      result === "ok"
        ? "Test sent. OneLedger received it."
        : "The test didn't get through. Check your connection and try again.",
    );
  }

  return (
    <>
      <Card style={{ gap: space[3] }}>
        <Badge variant="positive">All set</Badge>
        <Text variant="heading">Automatic recording is on</Text>
        <Text color="textSecondary">{health.detail}</Text>
        <Text variant="label" color="textMuted">
          Your next MoMo message will appear in OneLedger within a few
          minutes.
        </Text>
        <Button
          label="Send a test"
          variant="secondary"
          fullWidth
          loading={busy}
          onPress={test}
        />
        {notice ? (
          <Text variant="label" color="textSecondary" accessibilityRole="alert">
            {notice}
          </Text>
        ) : null}
      </Card>
      <Button label="Finish" fullWidth onPress={() => router.back()} />
    </>
  );
}

function Numbered({ n, text }: { n: number; text: string }) {
  return (
    <View style={{ flexDirection: "row", gap: space[2] }}>
      <Text variant="bodyStrong" color="accent">
        {n}.
      </Text>
      <Text variant="label" color="textSecondary" style={{ flex: 1 }}>
        {text}
      </Text>
    </View>
  );
}
