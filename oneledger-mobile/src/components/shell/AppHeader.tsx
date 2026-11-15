import Feather from "@expo/vector-icons/Feather";
import { router } from "expo-router";
import { useCallback, useState } from "react";
import { Image, Modal, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, Text } from "@/components/ds";
import { useSession } from "@/features/auth/SessionProvider";
import { getUnreadNotificationCount } from "@/features/notifications/queries";
import {
  badgeText,
  inboxAccessibilityLabel,
  inboxBadgeCount,
} from "@/features/shell/badge";
import { getReviewQueueCount } from "@/features/transactions/queries";
import { useQuery } from "@/hooks/useQuery";
import { colors, MIN_TOUCH_TARGET, radii, space } from "@/theme/tokens";

// The signed-in header, as on the web: brand mark left; Inbox (with a count
// badge), Statements and the profile menu right. Shown on the tab roots.
// The Space switcher and the Pay entry arrive in later steps.

async function loadBadge() {
  const [unread, review] = await Promise.all([
    getUnreadNotificationCount(),
    getReviewQueueCount().catch(() => 0),
  ]);
  return inboxBadgeCount(unread, review);
}

export function AppHeader() {
  const insets = useSafeAreaInsets();
  const { data: count } = useQuery(loadBadge);
  const [menuOpen, setMenuOpen] = useState(false);
  const badge = badgeText(count ?? 0);

  return (
    <View style={[styles.bar, { paddingTop: insets.top }]}>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="OneLedger home"
          onPress={() => router.navigate("/")}
          style={styles.logoHit}
        >
          <Image
            source={require("../../../assets/brand/oneledger-mark.png")}
            style={styles.logo}
            resizeMode="contain"
            accessibilityIgnoresInvertColors
          />
        </Pressable>

        <View style={styles.actions}>
          <IconButton
            icon="inbox"
            label={inboxAccessibilityLabel(count ?? 0)}
            onPress={() => router.navigate("/inbox")}
            badge={badge}
          />
          <IconButton
            icon="file-text"
            label="Statements"
            onPress={() => router.push("/statements")}
          />
          <IconButton icon="user" label="Account menu" onPress={() => setMenuOpen(true)} />
        </View>
      </View>
      <ProfileMenu visible={menuOpen} onClose={() => setMenuOpen(false)} />
    </View>
  );
}

function IconButton({
  icon,
  label,
  onPress,
  badge,
}: {
  icon: React.ComponentProps<typeof Feather>["name"];
  label: string;
  onPress(): void;
  badge?: string | null;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
    >
      <Feather name={icon} size={20} color={colors.textSecondary} />
      {badge ? (
        <View style={styles.badge}>
          <Text variant="caption" color="accentForeground" style={styles.badgeText}>
            {badge}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function ProfileMenu({ visible, onClose }: { visible: boolean; onClose(): void }) {
  const { session, signOut } = useSession();
  const go = useCallback(
    (path: "/notifications" | "/security") => {
      onClose();
      router.push(path);
    },
    [onClose],
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close menu">
        {/* Taps inside the sheet must not reach the scrim. */}
        <Pressable style={styles.sheet} onPress={() => {}}>
          <Text variant="caption" color="textMuted">
            Signed in as
          </Text>
          <Text variant="bodyStrong" numberOfLines={1}>
            {session?.user.email ?? "Unknown"}
          </Text>
          <View style={styles.menuActions}>
            <Button label="Notifications" variant="secondary" fullWidth onPress={() => go("/notifications")} />
            <Button label="App lock" variant="secondary" fullWidth onPress={() => go("/security")} />
            <Button
              label="Sign out"
              variant="ghost"
              fullWidth
              onPress={() => {
                onClose();
                void signOut();
              }}
            />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  row: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space[4],
    width: "100%",
    maxWidth: 480,
    alignSelf: "center",
  },
  logoHit: { minHeight: MIN_TOUCH_TARGET, justifyContent: "center", paddingRight: space[3] },
  logo: { width: 28, height: 28 },
  actions: { flexDirection: "row", alignItems: "center", gap: space[1] },
  iconButton: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    borderRadius: radii.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: { backgroundColor: colors.background },
  badge: {
    position: "absolute",
    top: 4,
    right: 4,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.notificationBadge,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { fontSize: 10, lineHeight: 12 },
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.card,
    borderTopRightRadius: radii.card,
    padding: space[4],
    paddingBottom: space[8],
    gap: space[1],
  },
  menuActions: { marginTop: space[3], gap: space[2] },
});
