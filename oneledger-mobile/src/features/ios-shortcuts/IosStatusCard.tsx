import { router } from "expo-router";
import { useCallback } from "react";
import { View } from "react-native";

import { Badge, Button, Card, Text } from "@/components/ds";
import { getDeviceStatus } from "@/features/pairing/pairing";
import { useQuery } from "@/hooks/useQuery";
import { space } from "@/theme/tokens";
import { MenuRow } from "@/features/settings/MenuUI";

import { iosHealthDisplay } from "./ios-health";
import { loadIosDeviceCredentialId } from "./store";

/**
 * Whether this iPhone's Shortcut is getting messages through. The app cannot
 * see the Shortcut, so this reads the server's record of the device (when it
 * last sent anything) for the connection remembered from the setup guide.
 * Refreshes whenever the screen comes back into focus.
 */
export function IosStatusCard({ compact = false }: { compact?: boolean }) {
  const load = useCallback(async () => {
    const id = await loadIosDeviceCredentialId();
    return { device: id ? await getDeviceStatus(id) : null, now: Date.now() };
  }, []);
  const { data, loading, error } = useQuery(load);

  if (compact) {
    const display = data?.device ? iosHealthDisplay(data.device, data.now) : null;
    return <MenuRow role="link" icon="smartphone" label="Automatic recording" value={loading ? "Checking…" : error ? "Check status" : display ? (display.label === "Waiting for the first message" ? "Waiting" : display.label === "Nothing received lately" ? "Check steps" : display.label) : "Set up"} hint={error ? "Status unavailable. Tap to check the steps." : !loading && !data?.device ? "Finish setup · About 5 minutes" : undefined} onPress={() => router.push("/shortcuts")} />;
  }

  if (loading || !data) return null;
  const { device, now } = data;

  if (!device) {
    return (
      <Card style={{ gap: space[3] }}>
        <Text variant="bodyStrong">This iPhone</Text>
        <Badge variant="attention">Not set up</Badge>
        <Text variant="label" color="textSecondary">
          Add two Shortcuts and one automation, and OneLedger records your MoMo
          messages on its own. It takes about five minutes.
        </Text>
        <Button label="Set up on iPhone" fullWidth onPress={() => router.push("/shortcuts")} />
      </Card>
    );
  }

  const display = iosHealthDisplay(device, now);
  return (
    <Card style={{ gap: space[3] }}>
      <Text variant="bodyStrong">This iPhone</Text>
      <View style={{ flexDirection: "row" }}>
        <Badge variant={display.variant}>{display.label}</Badge>
      </View>
      <Text variant="label" color="textSecondary">
        {display.detail}
      </Text>
      <Button
        label={display.variant === "attention" ? "Fix it" : "Check the steps"}
        variant={display.variant === "attention" ? "primary" : "secondary"}
        fullWidth
        onPress={() => router.push("/shortcuts")}
      />
    </Card>
  );
}
