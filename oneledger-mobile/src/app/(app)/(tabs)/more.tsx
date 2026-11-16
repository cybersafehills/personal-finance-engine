import { router } from "expo-router";
import { useCallback, useState } from "react";
import { Platform } from "react-native";

import { Badge, Button, Card, Screen, ScreenHeader, Text } from "@/components/ds";
import { useSession } from "@/features/auth/SessionProvider";
import { captureSupported, getCaptureHealth } from "@/features/capture/capture";
import { healthDisplay } from "@/features/capture/health-display";
import { IosStatusCard } from "@/features/ios-shortcuts/IosStatusCard";
import { getUnreadNotificationCount } from "@/features/notifications/queries";
import {
  disablePush,
  enablePush,
  isPushEnabled,
  pushSupported,
} from "@/features/push/push";
import { useQuery } from "@/hooks/useQuery";
import { space } from "@/theme/tokens";

export default function More() {
  const { session, signOut } = useSession();
  const load = useCallback(() => getCaptureHealth(), []);
  const { data: health } = useQuery(load);
  const display = health ? healthDisplay(health.state) : null;

  return (
    <Screen edges={["left", "right", "bottom"]}>
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
            : "On iPhone, OneLedger records MoMo messages with an Apple Shortcut."}
        </Text>
        {Platform.OS === "web" ? (
          <Button
            label="Set up on iPhone"
            variant={captureSupported ? "secondary" : "primary"}
            fullWidth
            onPress={() => router.push("/shortcuts")}
          />
        ) : null}
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

      {Platform.OS === "ios" ? <IosStatusCard /> : null}

      <NotificationsCard />

      <Card style={{ gap: space[3] }}>
        <Text variant="bodyStrong">Statements</Text>
        <Text variant="label" color="textSecondary">
          Your generated statements, to view or download.
        </Text>
        <Button
          label="Open statements"
          variant="secondary"
          fullWidth
          onPress={() => router.push("/statements")}
        />
      </Card>

      <Card style={{ gap: space[3] }}>
        <Text variant="bodyStrong">Goals</Text>
        <Text variant="label" color="textSecondary">
          See how your savings goals are going.
        </Text>
        <Button
          label="Open goals"
          variant="secondary"
          fullWidth
          onPress={() => router.push("/goals")}
        />
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

async function loadNotificationsCard() {
  const [unread, enabled] = await Promise.all([
    getUnreadNotificationCount(),
    isPushEnabled(),
  ]);
  return { unread, enabled };
}

function NotificationsCard() {
  const { data, refresh } = useQuery(loadNotificationsCard);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function toggle() {
    if (busy || !data) return;
    setBusy(true);
    setMessage(null);
    if (data.enabled) {
      await disablePush();
    } else {
      const result = await enablePush();
      if (!result.ok) setMessage(result.message);
    }
    setBusy(false);
    refresh();
  }

  return (
    <Card style={{ gap: space[3] }}>
      <Text variant="bodyStrong">Notifications</Text>
      {data && data.unread > 0 ? (
        <Badge variant="attention">{`${data.unread} new`}</Badge>
      ) : null}
      <Button
        label="See notifications"
        variant="secondary"
        fullWidth
        onPress={() => router.push("/notifications")}
      />
      {pushSupported ? (
        <Button
          label={data?.enabled ? "Turn off phone alerts" : "Turn on phone alerts"}
          variant={data?.enabled ? "ghost" : "primary"}
          fullWidth
          loading={busy}
          onPress={toggle}
        />
      ) : (
        <Text variant="label" color="textMuted">
          Phone alerts need the app installed on a real phone.
        </Text>
      )}
      {message ? (
        <Text variant="label" color="attention" accessibilityRole="alert">
          {message}
        </Text>
      ) : null}
    </Card>
  );
}
