import { router } from "expo-router";
import { useCallback, useState } from "react";
import { Platform } from "react-native";

import { fetchMoreFlags } from "@/api/mobile-api";
import { Badge, ListGroup, ListRow, Screen, ScreenHeader, Text } from "@/components/ds";
import { useSession } from "@/features/auth/SessionProvider";
import { captureSupported, getCaptureHealth } from "@/features/capture/capture";
import { healthDisplay } from "@/features/capture/health-display";
import { IosStatusCard } from "@/features/ios-shortcuts/IosStatusCard";
import { visibleGroups } from "@/features/more/groups";
import { MORE_ICONS } from "@/features/more/icons";
import { getUnreadNotificationCount } from "@/features/notifications/queries";
import { disablePush, enablePush, isPushEnabled, pushSupported } from "@/features/push/push";
import { useQuery } from "@/hooks/useQuery";

// More: everything that isn't a tab, as grouped lists (icon, label, one-line hint,
// chevron) rather than a card per section, with the phone-level settings first.
export default function More() {
  const { session, signOut } = useSession();

  return (
    <Screen edges={["left", "right", "bottom"]}>
      <ScreenHeader title="More" inline />

      <ListGroup>
        <ListRow icon="user" label={session?.user.email ?? "Unknown"} hint="Signed in" />
      </ListGroup>

      <ThisPhone />

      {Platform.OS === "ios" ? <IosStatusCard /> : null}

      <MoreGroups />

      <ListGroup>
        <ListRow icon="log-out" label="Sign out" destructive onPress={signOut} />
      </ListGroup>
    </Screen>
  );
}

async function loadPhone() {
  const [health, unread, pushOn] = await Promise.all([
    getCaptureHealth(),
    getUnreadNotificationCount(),
    isPushEnabled(),
  ]);
  return { health, unread, pushOn };
}

/** Recording, notifications and phone alerts: the settings that belong to this device. */
function ThisPhone() {
  const { data, refresh } = useQuery(loadPhone);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const display = data?.health ? healthDisplay(data.health.state) : null;

  async function togglePush(next: boolean) {
    if (busy || !data) return;
    setBusy(true);
    setMessage(null);
    if (next) {
      const result = await enablePush();
      if (!result.ok) setMessage(result.message);
    } else {
      await disablePush();
    }
    setBusy(false);
    refresh();
  }

  const needsSetup = !!display && display.action !== "none";

  return (
    <ListGroup title="This phone" footer={message ?? undefined}>
      {captureSupported ? (
        <ListRow
          icon="radio"
          label="Automatic recording"
          hint={needsSetup ? undefined : "MoMo transactions recorded from this phone."}
          value={
            needsSetup ? (
              <Text variant="label" color="accent">
                Set it up
              </Text>
            ) : display ? (
              <Badge variant={display.variant}>{display.label}</Badge>
            ) : undefined
          }
          onPress={() => router.push(needsSetup ? "/connect" : "/capture")}
        />
      ) : Platform.OS === "web" ? (
        <ListRow
          icon="smartphone"
          label="Set up on iPhone"
          hint="OneLedger records MoMo messages with an Apple Shortcut."
          onPress={() => router.push("/shortcuts")}
        />
      ) : null}
      <ListRow
        icon="bell"
        label="Notifications"
        value={data && data.unread > 0 ? <Badge variant="attention">{`${data.unread} new`}</Badge> : undefined}
        onPress={() => router.push("/notifications")}
      />
      {pushSupported ? (
        <ListRow
          icon="smartphone"
          label="Phone alerts"
          hint="Get a notification on this phone."
          toggle={!!data?.pushOn}
          onToggle={togglePush}
          toggleDisabled={busy || !data}
        />
      ) : (
        <ListRow icon="smartphone" label="Phone alerts" hint="Phone alerts need the app installed on a real phone." />
      )}
    </ListGroup>
  );
}

function MoreGroups() {
  const load = useCallback(() => fetchMoreFlags(), []);
  const { data: flags } = useQuery(load);
  return (
    <>
      {visibleGroups(flags ?? null).map((group) => (
        <ListGroup key={group.title} title={group.title}>
          {group.links.map((link) => (
            <ListRow
              key={link.route}
              role="link"
              icon={MORE_ICONS[link.route]}
              label={link.label}
              hint={link.hint}
              onPress={() => router.push(link.route)}
            />
          ))}
        </ListGroup>
      ))}
    </>
  );
}
