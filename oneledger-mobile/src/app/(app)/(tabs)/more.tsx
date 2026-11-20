import Feather from "@expo/vector-icons/Feather";
import { router } from "expo-router";
import { useCallback, useState } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { fetchMoreFlags } from "@/api/mobile-api";
import { Badge, Text, TextField } from "@/components/ds";
import { captureSupported, getCaptureHealth } from "@/features/capture/capture";
import { healthDisplay } from "@/features/capture/health-display";
import { IosStatusCard } from "@/features/ios-shortcuts/IosStatusCard";
import { visibleGroups } from "@/features/more/groups";
import { MORE_ICONS } from "@/features/more/icons";
import { getUnreadNotificationCount } from "@/features/notifications/queries";
import { MenuGroup, MenuRow, MenuScreen, ProfileSummary } from "@/features/settings/MenuUI";
import { useQuery } from "@/hooks/useQuery";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

export default function More() {
  const { colors } = useTheme();
  const styles = useStyles();
  const load = useCallback(() => fetchMoreFlags(), []);
  const { data: flags } = useQuery(load);
  const { data: unread } = useQuery(getUnreadNotificationCount);
  const [search, setSearch] = useState("");
  const query = search.trim().toLocaleLowerCase();
  const groups = visibleGroups(flags ?? null).map((group) => ({
    ...group, links: group.links.filter((link) => !query || `${link.label} ${link.hint}`.toLocaleLowerCase().includes(query)),
  })).filter((group) => group.links.length > 0);
  const showRecording = !query || "automatic recording this phone iphone shortcuts setup".includes(query);
  return (
    <MenuScreen title="More" root action={
      <Pressable accessibilityRole="link" accessibilityLabel={unread ? `Notifications, ${unread} unread` : "Notifications"} onPress={() => router.push("/notifications")} style={({ pressed }) => [styles.inbox, pressed && styles.pressed]}>
        <Feather name="bell" size={23} color={colors.accent} />
        {unread && unread > 0 ? <Badge variant="neutral">{unread > 99 ? "99+" : String(unread)}</Badge> : null}
      </Pressable>
    }>
      <ProfileSummary onPress={() => router.push("/settings")} />
      <TextField compact label="Search tools" placeholder="Search tools" value={search} onChangeText={setSearch} autoCapitalize="none" autoCorrect={false} returnKeyType="search" leading={<Feather name="search" size={19} color={colors.textMuted} />} />
      {groups.map((group) => (
        <MenuGroup key={group.title} title={group.title}>
          {group.links.map((link) => <MenuRow key={link.route} role="link" icon={MORE_ICONS[link.route]} label={link.label} onPress={() => router.push(link.route)} />)}
          {group.title === "Account" && showRecording ? <RecordingRow /> : null}
        </MenuGroup>
      ))}
      {showRecording && !groups.some((group) => group.title === "Account") ? <MenuGroup title="This phone"><RecordingRow /></MenuGroup> : null}
      {!groups.length && !showRecording ? <View style={styles.empty}><Feather name="search" size={32} color={colors.textMuted} /><Text variant="heading">No tools found</Text><Text color="textMuted">Try “wallet”, “report” or “settings”.</Text></View> : null}
    </MenuScreen>
  );
}
function RecordingRow() {
  if (captureSupported) return <AndroidRecordingRow />;
  if (Platform.OS === "ios") return <IosStatusCard compact />;
  if (Platform.OS === "web") return <MenuRow role="link" icon="smartphone" label="Set up on iPhone" onPress={() => router.push("/shortcuts")} />;
  return <MenuRow role="link" icon="smartphone" label="Automatic recording" value="Unavailable" onPress={() => router.push("/capture")} />;
}
function AndroidRecordingRow() {
  const { data, error, loading } = useQuery(getCaptureHealth);
  const display = data ? healthDisplay(data.state) : null;
  const needsSetup = !!display && display.action !== "none";
  return <MenuRow role="link" icon="smartphone" label="Automatic recording" value={needsSetup ? "Set it up" : display?.label ?? (loading ? "Checking…" : "Check status")} hint={error ? "Status unavailable. Tap to check." : undefined} onPress={() => router.push(needsSetup ? "/connect" : "/capture")} />;
}
const useStyles = makeStyles((c) => StyleSheet.create({
  inbox: { minWidth: 44, minHeight: 44, borderRadius: 22, paddingHorizontal: 8, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center" },
  pressed: { backgroundColor: c.accentBg },
  empty: { paddingVertical: 32, alignItems: "center", gap: 12 },
}));
