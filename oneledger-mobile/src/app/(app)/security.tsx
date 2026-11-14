import { router } from "expo-router";
import { useState } from "react";
import { Switch, View } from "react-native";

import { Button, Card, Screen, ScreenHeader, Text } from "@/components/ds";
import { useLock } from "@/features/lock/LockProvider";
import { colors, space } from "@/theme/tokens";

export default function Security() {
  const { available, enabled, setEnabled } = useLock();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function toggle(next: boolean) {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    const changed = await setEnabled(next);
    setBusy(false);
    if (!changed) {
      setMessage("Couldn't confirm it's you, so nothing was changed.");
    }
  }

  return (
    <Screen>
      <ScreenHeader
        title="Security"
        subtitle="Protect the app on this phone"
        action={
          <Button label="Back" variant="ghost" onPress={() => router.back()} />
        }
      />

      <Card style={{ gap: space[3] }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: space[3],
          }}
        >
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="bodyStrong">App lock</Text>
            <Text variant="label" color="textMuted">
              Ask for your fingerprint, face or phone passcode when you open
              OneLedger, and after a minute away.
            </Text>
          </View>
          <Switch
            accessibilityLabel="App lock"
            value={enabled}
            disabled={!available || busy}
            onValueChange={toggle}
            trackColor={{ true: colors.accent, false: colors.borderStrong }}
          />
        </View>

        {!available ? (
          <Text variant="label" color="attention">
            App lock needs a fingerprint, face or passcode set up on this
            phone. It isn&apos;t available in the web preview.
          </Text>
        ) : null}
        {message ? (
          <Text variant="label" color="attention" accessibilityRole="alert">
            {message}
          </Text>
        ) : null}
      </Card>

      <Text variant="label" color="textMuted">
        Recording your MoMo messages keeps working while the app is locked.
      </Text>
    </Screen>
  );
}
