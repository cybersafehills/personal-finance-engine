import { router } from "expo-router";
import { useCallback } from "react";

import { Badge, Button, Card, Screen, ScreenHeader, Text } from "@/components/ds";
import { useSession } from "@/features/auth/SessionProvider";
import { captureSupported, getCaptureHealth } from "@/features/capture/capture";
import { healthDisplay } from "@/features/capture/health-display";
import { useQuery } from "@/hooks/useQuery";
import { space } from "@/theme/tokens";

export default function More() {
  const { session, signOut } = useSession();
  const load = useCallback(() => getCaptureHealth(), []);
  const { data: health } = useQuery(load);
  const display = health ? healthDisplay(health.state) : null;

  return (
    <Screen>
      <ScreenHeader title="More" />

      <Card style={{ gap: space[1] }}>
        <Text variant="caption" color="textMuted">
          Signed in as
        </Text>
        <Text variant="bodyStrong">{session?.user.email ?? "Unknown"}</Text>
      </Card>

      <Card style={{ gap: space[3] }}>
        <Text variant="bodyStrong">Automatic recording</Text>
        {display ? <Badge variant={display.variant}>{display.label}</Badge> : null}
        <Text variant="label" color="textSecondary">
          {captureSupported
            ? "OneLedger records MoMo transactions from this phone's notifications."
            : "Works on Android phones. An iPhone guide is coming to the app."}
        </Text>
        {captureSupported ? (
          <>
            {display && display.action !== "none" ? (
              <Button label="Set it up" fullWidth onPress={() => router.push("/connect")} />
            ) : null}
            <Button
              label="Recording status"
              variant="secondary"
              fullWidth
              onPress={() => router.push("/capture")}
            />
          </>
        ) : null}
      </Card>

      <Card style={{ gap: space[3] }}>
        <Text variant="bodyStrong">Security</Text>
        <Button
          label="App lock"
          variant="secondary"
          fullWidth
          onPress={() => router.push("/security")}
        />
      </Card>

      <Button label="Sign out" variant="ghost" fullWidth onPress={signOut} />
    </Screen>
  );
}
