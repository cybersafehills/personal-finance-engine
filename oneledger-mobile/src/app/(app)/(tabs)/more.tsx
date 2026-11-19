import { router } from "expo-router";
import { useCallback, useState } from "react";
import { Platform, Pressable, View } from "react-native";

import { Badge, Button, Card, Screen, ScreenHeader, Text } from "@/components/ds";
import { fetchMoreFlags } from "@/api/mobile-api";
import { useSession } from "@/features/auth/SessionProvider";
import { captureSupported, getCaptureHealth } from "@/features/capture/capture";
import { healthDisplay } from "@/features/capture/health-display";
import { IosStatusCard } from "@/features/ios-shortcuts/IosStatusCard";
import { visibleGroups } from "@/features/more/groups";
import { getUnreadNotificationCount } from "@/features/notifications/queries";
import {
  disablePush,
  enablePush,
  isPushEnabled,
  pushSupported,
} from "@/features/push/push";
import { useQuery } from "@/hooks/useQuery";
import { colors, space } from "@/theme/tokens";

export default function More() {
  const { session, signOut } = useSession();
  const load = useCallback(() => getCaptureHealth(), []);
  const { data: health } = useQuery(load);
  // Bills is switched on per Space on the server; offer it only where it will work.
  const display = health ? healthDisplay(health.state) : null;

  return (
    <Screen edges={["left", "right", "bottom"]}>
      <ScreenHeader title="More" inline />

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

      <MoreGroups />

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

function MoreGroups() {
  const load = useCallback(() => fetchMoreFlags(), []);
  const { data: flags } = useQuery(load);
  return (
    <>
      {visibleGroups(flags ?? null).map((group) => (
        <View key={group.title} style={{ gap: space[2] }}>
          <Text variant="bodyStrong" accessibilityRole="header">
            {group.title}
          </Text>
          <Card style={{ paddingVertical: 0 }}>
            {group.links.map((link, index) => (
              <Pressable
                key={link.route}
                accessibilityRole="link"
                accessibilityLabel={link.label}
                onPress={() => router.push(link.route)}
                style={{
                  minHeight: 56,
                  justifyContent: "center",
                  paddingVertical: space[3],
                  borderTopWidth: index === 0 ? 0 : 1,
                  borderTopColor: colors.borderSubtle,
                }}
              >
                <Text variant="bodyStrong">{link.label}</Text>
                <Text variant="caption" color="textMuted">
                  {link.hint}
                </Text>
              </Pressable>
            ))}
          </Card>
        </View>
      ))}
    </>
  );
}
