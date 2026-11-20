import Feather from "@expo/vector-icons/Feather";
import { router } from "expo-router";
import { useCallback, useState } from "react";
import { Image, Modal, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ListGroup, ListRow, Text } from "@/components/ds";
import { useSession } from "@/features/auth/SessionProvider";
import { useActiveSpace } from "@/features/spaces/ActiveSpaceProvider";
import { kindLabel } from "@/features/spaces/spaces";
import { SyncStatusChip } from "@/offline/SyncStatusChip";
import { getUnreadNotificationCount } from "@/features/notifications/queries";
import {
  badgeText,
  inboxAccessibilityLabel,
  inboxBadgeCount,
} from "@/features/shell/badge";
import { getReviewQueueCount } from "@/features/transactions/queries";
import { useQuery } from "@/hooks/useQuery";
import { CONTROL_HEIGHT, hitSlopFor, radii, space } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

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
  const styles = useStyles();
  const { isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { data: count } = useQuery(loadBadge);
  const [menuOpen, setMenuOpen] = useState(false);
  const badge = badgeText(count ?? 0);
  const { spaces, active } = useActiveSpace();

  return (
    <View style={[styles.bar, { paddingTop: insets.top }]}>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="OneLedger home"
          onPress={() => router.navigate("/")}
          style={styles.logoHit}
        >
          {/* The mark is dark on transparency: in the dark theme it sits on a light plate so it still reads. */}
          <View style={isDark ? styles.logoPlate : undefined}>
            <Image
              source={require("../../../assets/brand/oneledger-mark.png")}
              style={styles.logo}
              resizeMode="contain"
              accessibilityIgnoresInvertColors
            />
          </View>
        </Pressable>

        <View style={styles.actions}>
          <SyncStatusChip />
          {/* As on the web: the current Space as a chip, only with more than one. */}
          {spaces.length > 1 && active ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Space: ${active.name}. Change Space`}
              onPress={() => setMenuOpen(true)}
              style={styles.chip}
            >
              <Text variant="caption" color="accent" numberOfLines={1} style={styles.chipText}>
                {active.name}
              </Text>
            </Pressable>
          ) : null}
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
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={hitSlopFor(CONTROL_HEIGHT.md)}
      style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
    >
      <Feather name={icon} size={20} color={colors.textSecondary} />
      {badge ? (
        <View style={styles.badge}>
          <Text variant="caption" color="onSolid" style={styles.badgeText}>
            {badge}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function ProfileMenu({ visible, onClose }: { visible: boolean; onClose(): void }) {
  const styles = useStyles();
  const { session, signOut } = useSession();
  const { spaces, active, setActive } = useActiveSpace();
  const go = useCallback(
    (path: "/notifications" | "/security" | "/create-space" | "/space-members") => {
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
          {spaces.length > 1 ? (
            <View style={styles.spaces} accessibilityRole="radiogroup">
              <Text variant="caption" color="textMuted">
                Space
              </Text>
              {spaces.map((space) => {
                const selected = space.id === active?.id;
                return (
                  <Pressable
                    key={space.id}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`${space.name}, ${kindLabel(space.kind)}`}
                    onPress={() => {
                      setActive(space.id);
                      onClose();
                    }}
                    style={[styles.spaceRow, selected && styles.spaceRowSelected]}
                  >
                    <Text variant="bodyStrong" numberOfLines={1} style={styles.spaceName}>
                      {space.name}
                    </Text>
                    <Text variant="caption" color="textMuted">
                      {kindLabel(space.kind)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
          <View style={styles.menu}>
            <ListGroup>
              <ListRow icon="users" label="Space & members" onPress={() => go("/space-members")} />
              <ListRow icon="plus-circle" label="Create a Space" onPress={() => go("/create-space")} />
              <ListRow icon="bell" label="Notifications" onPress={() => go("/notifications")} />
              <ListRow icon="lock" label="App lock" onPress={() => go("/security")} />
              <ListRow
                icon="log-out"
                label="Sign out"
                destructive
                onPress={() => {
                  onClose();
                  void signOut();
                }}
              />
            </ListGroup>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  bar: {
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  row: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space[4],
    width: "100%",
    maxWidth: 480,
    alignSelf: "center",
  },
  logoHit: { minHeight: CONTROL_HEIGHT.md, justifyContent: "center", paddingRight: space[3] },
  logo: { width: 26, height: 26 },
  logoPlate: { backgroundColor: colors.onSolid, borderRadius: 8, padding: 3 },
  actions: { flexDirection: "row", alignItems: "center", gap: space[1] },
  iconButton: {
    width: CONTROL_HEIGHT.md,
    height: CONTROL_HEIGHT.md,
    borderRadius: radii.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: { backgroundColor: colors.background },
  badge: {
    position: "absolute",
    top: 3,
    right: 3,
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
  menu: { marginTop: space[3] },
  chip: {
    maxWidth: 120,
    minHeight: CONTROL_HEIGHT.sm,
    justifyContent: "center",
    paddingHorizontal: space[2],
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  chipText: { fontSize: 12 },
  spaces: { marginTop: space[3], gap: space[1] },
  spaceRow: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space[3],
    paddingHorizontal: space[3],
    borderRadius: radii.control,
  },
  spaceRowSelected: { backgroundColor: colors.background },
  spaceName: { flex: 1 },
}));
