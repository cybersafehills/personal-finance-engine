import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, AppState, View } from "react-native";

import {
  Badge,
  Button,
  Card,
  EmptyState,
  Screen,
  ScreenHeader,
  Text,
} from "@/components/ds";
import {
  captureSupported,
  disconnectDevice,
  getCaptureHealth,
  sendCaptureTest,
  type CaptureHealth,
} from "@/features/capture/capture";
import {
  formatLastSuccess,
  healthDisplay,
} from "@/features/capture/health-display";
import { space } from "@/theme/tokens";

const TEST_MESSAGES = {
  ok: "Test sent. OneLedger received it.",
  not_paired: "This phone isn't connected yet.",
  reauthentication_required:
    "This phone was disconnected from OneLedger. Connect it again.",
  rejected: "OneLedger didn't accept the test. Try again later.",
  unreachable: "Couldn't reach OneLedger. Check your connection.",
} as const;

// Status of automatic recording on this phone. Read-only view of the native
// engine's health plus the few actions JS is allowed to trigger.
export default function Capture() {
  const [health, setHealth] = useState<CaptureHealth | null>(null);
  // When `health` was read; "last sent" is shown relative to this.
  const [checkedAt, setCheckedAt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const next = await getCaptureHealth();
    setHealth(next);
    setCheckedAt(Date.now());
  }, []);

  // Refresh when the screen is shown and when the user comes back from
  // system settings (where notification access is granted).
  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  async function runTest() {
    setBusy(true);
    setNotice(null);
    const result = await sendCaptureTest();
    setBusy(false);
    if (result) setNotice(TEST_MESSAGES[result]);
    refresh();
  }

  function confirmDisconnect() {
    Alert.alert(
      "Disconnect this phone?",
      "OneLedger will stop recording money messages from this phone. To finish, also remove the phone in OneLedger on the web.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Disconnect",
          style: "destructive",
          onPress: async () => {
            await disconnectDevice();
            setNotice(null);
            refresh();
          },
        },
      ],
    );
  }

  const header = (
    <ScreenHeader
      title="Automatic recording"
      subtitle="MoMo messages on this phone"
      action={
        <Button label="Back" variant="ghost" onPress={() => router.back()} />
      }
    />
  );

  if (!captureSupported) {
    return (
      <Screen>
        {header}
        <EmptyState
          variant="setup"
          title="Not available on this device"
          description="Automatic recording works on Android phones. On iPhone, OneLedger uses a Shortcut instead; that guide is coming to the app."
        />
      </Screen>
    );
  }

  if (!health) {
    return <Screen>{header}</Screen>;
  }

  const display = healthDisplay(health.state);

  return (
    <Screen>
      {header}

      <Card style={{ gap: space[3] }}>
        <Badge variant={display.variant}>{display.label}</Badge>
        <Text color="textSecondary">{health.detail}</Text>

        {display.action === "allow_access" ? (
          <Button
            label="Fix this"
            fullWidth
            onPress={() => router.push("/connect")}
          />
        ) : null}
        {display.action === "connect" || display.action === "reconnect" ? (
          <Button
            label={display.action === "connect" ? "Set it up" : "Connect again"}
            fullWidth
            onPress={() => router.push("/connect")}
          />
        ) : null}
      </Card>

      {health.paired ? (
        <Card style={{ gap: space[3] }}>
          <Row label="Last sent" value={formatLastSuccess(health.lastSuccessAtMs, checkedAt)} />
          <Row label="Waiting to send" value={String(health.pendingCount)} />
          <Row label="Couldn't be sent" value={String(health.deadCount)} />
          <Button
            label="Send a test"
            variant="secondary"
            fullWidth
            loading={busy}
            onPress={runTest}
          />
          {notice ? (
            <Text variant="label" color="textSecondary" accessibilityRole="alert">
              {notice}
            </Text>
          ) : null}
        </Card>
      ) : null}

      <Text variant="label" color="textMuted">
        OneLedger only keeps messages it recognises as MoMo transactions.
        Everything else is ignored on your phone and never sent.
      </Text>

      {health.paired ? (
        <Button
          label="Disconnect this phone"
          variant="ghost"
          fullWidth
          onPress={confirmDisconnect}
        />
      ) : null}
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View
      style={{
        flexDirection: "row",
        justifyContent: "space-between",
        gap: space[3],
      }}
    >
      <Text variant="label" color="textMuted">
        {label}
      </Text>
      <Text variant="label" tabular>
        {value}
      </Text>
    </View>
  );
}
