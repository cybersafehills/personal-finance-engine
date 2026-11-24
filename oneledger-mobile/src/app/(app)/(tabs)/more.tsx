import { usePartnerPreview } from "@/features/partners/PartnerPreviewProvider";
import { ThemeCycleButton } from "@/features/settings/ThemeCycleButton";
import { GuideSuggestion } from "@/features/guides/GuideSuggestion";
import { GuideAnchor } from "@/features/guides/GuideAnchor";
import Feather from "@expo/vector-icons/Feather";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { NotificationButton } from "@/components/shell/NotificationButton";
import { useMoreFlags } from "@/features/more/flags-cache";
import { Text, TextField } from "@/components/ds";
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
  const { mode: partnerMode } = usePartnerPreview();
  const flags = useMoreFlags();
  const { data: unread } = useQuery(getUnreadNotificationCount);
  const { guideReset } = useLocalSearchParams<{ guideReset?: string }>();
  const [searchState, setSearchState] = useState({ reset: guideReset, value: "" });
  const search = searchState.reset === guideReset ? searchState.value : "";
  const setSearch = (value: string) => setSearchState({ reset: guideReset, value });
  const query = search.trim().toLocaleLowerCase();
  const groups = visibleGroups(flags ?? null).map((group) => ({
    ...group, links: group.links.filter((link) => !query || `${link.label} ${link.hint}`.toLocaleLowerCase().includes(query)),
  })).filter((group) => group.links.length > 0);
  const showGuides = !query || "guides help tutorial onboarding tour".includes(query);
  const showOffers = partnerMode !== "off" && (!query || "offers partners benefits brands".includes(query));
  const showPartnerPreview = __DEV__ && (!query || "partner placement design preview".includes(query));
  const showRecording = !query || "automatic recording this phone iphone shortcuts setup".includes(query);
  return (
    <MenuScreen title="More" root action={
      <View style={{flexDirection:"row",alignItems:"center",gap:6}}><ThemeCycleButton/><NotificationButton unread={unread ?? 0} onPress={() => router.push("/notifications")} /></View>
    }>
      <ProfileSummary onPress={() => router.push("/profile")} />
      <TextField compact label="Search tools" placeholder="Search tools" value={search} onChangeText={setSearch} autoCapitalize="none" autoCorrect={false} returnKeyType="search" leading={<Feather name="search" size={19} color={colors.textMuted} />} />
      <GuideSuggestion id="documents" enabled={flags?.statements === true && !query} />
      {groups.map((group) => (
        <MenuGroup key={group.title} title={group.title}>
          {group.links.map((link) => <GuideAnchor key={link.route} enabled={link.route !== "/statements" || flags?.statements === true} id={link.route === "/reports" ? "reports-entry" : link.route === "/statements" ? "statements-entry" : `tool-${link.route}`}><MenuRow role="link" icon={MORE_ICONS[link.route]} label={link.label} onPress={() => router.push(link.route)} /></GuideAnchor>)}
          {group.title === "Account" && showRecording ? <RecordingRow /> : null}
        </MenuGroup>
      ))}
      {showRecording && !groups.some((group) => group.title === "Account") ? <MenuGroup title="This phone"><RecordingRow /></MenuGroup> : null}
      {showOffers ? <MenuGroup title="Discover"><MenuRow role="link" icon="gift" label="Offers & partners" hint="Explore clearly labelled partner benefits" onPress={() => router.push("/partner-offers")}/></MenuGroup> : null}
      {showPartnerPreview ? <MenuGroup title="Design preview"><MenuRow role="link" icon="layout" label="Partner placement preview" hint="Review example advertising in the mobile app" onPress={() => router.push("/partner-preview")}/></MenuGroup> : null}
      {showGuides ? <MenuGroup title="Here to help"><GuideAnchor id="guides-entry"><MenuRow role="link" icon="help-circle" label="Guides & help" hint="Start, resume or replay a quick guide" onPress={() => router.push("/guides")} /></GuideAnchor></MenuGroup> : null}
      {!groups.length && !showRecording && !showGuides && !showOffers && !showPartnerPreview ? <View style={styles.empty}><Feather name="search" size={32} color={colors.textMuted} /><Text variant="heading">No tools found</Text><Text color="textMuted">Try “wallet”, “report” or “settings”.</Text></View> : null}
    </MenuScreen>
  );
}
function RecordingRow() {
  if (captureSupported) return <AndroidRecordingRow />;
  if (Platform.OS === "ios") return <GuideAnchor id="recording" follow={() => router.push("/shortcuts")}><IosStatusCard compact /></GuideAnchor>;
  if (Platform.OS === "web") return <MenuRow role="link" icon="smartphone" label="Set up on iPhone" onPress={() => router.push("/shortcuts")} />;
  return <MenuRow role="link" icon="smartphone" label="Automatic recording" value="Unavailable" onPress={() => router.push("/capture")} />;
}
function AndroidRecordingRow() {
  const { data, error, loading } = useQuery(getCaptureHealth);
  const display = data ? healthDisplay(data.state) : null;
  const needsSetup = !!display && display.action !== "none";
  return <GuideAnchor id="recording" enabled={!!data && !error} follow={() => router.push(needsSetup ? "/connect" : "/capture")}><MenuRow role="link" icon="smartphone" label="Automatic recording" value={needsSetup ? "Set it up" : display?.label ?? (loading ? "Checking…" : "Check status")} hint={error ? "Status unavailable. Tap to check." : undefined} onPress={() => router.push(needsSetup ? "/connect" : "/capture")} /></GuideAnchor>;
}
const useStyles = makeStyles((c) => StyleSheet.create({
  empty: { paddingVertical: 32, alignItems: "center", gap: 12 },
}));
