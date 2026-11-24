import { GuideAnchor } from "@/features/guides/GuideAnchor";
import * as Linking from "expo-linking";
import { router } from "expo-router";
import { useState } from "react";
import { useMoreFlags } from "@/features/more/flags-cache";
import { Text } from "@/components/ds";
import { useLock } from "@/features/lock/LockProvider";
import { MenuGroup, MenuRow, MenuScreen, ProfileSummary, SignOutRow } from "@/features/settings/MenuUI";
import { visibleSettingsGroups, type SettingsRow } from "@/features/settings/groups";
import { config } from "@/lib/config";
import { useTheme } from "@/theme/ThemeProvider";

export default function Settings() {
  const { preference } = useTheme();
  const { enabled, available, loading } = useLock();
  const flags = useMoreFlags();
  const [message, setMessage] = useState<string | null>(null);
  async function open(row: Pick<SettingsRow, "route" | "webPath">) {
    setMessage(null);
    if (row.route) router.push(row.route);
    else if (row.webPath) {
      try { await Linking.openURL(`${config.apiBaseUrl}${row.webPath}`); }
      catch { setMessage("Couldn't open your browser. Please try again."); }
    }
  }
  return (
    <MenuScreen title="Settings">
      <ProfileSummary onPress={() => router.push("/profile")} />
      {message ? <Text color="attention" accessibilityRole="alert">{message}</Text> : null}
      {visibleSettingsGroups(flags ?? null).map((group) => (
        <MenuGroup key={group.title} title={group.title}>
          {group.rows.map((row) => (
            <GuideAnchor key={row.label} id={row.route ? `setting-${row.route.slice(1)}` : row.webPath === "/settings/accounts" ? "setting-accounts" : `setting-${row.label.toLowerCase().replace(/[^a-z0-9]+/g,"-")}`}><MenuRow role="link" icon={row.icon} label={row.label}
              value={row.route === "/appearance" ? (preference === "system" ? "Automatic" : preference === "dark" ? "Dark" : "Light") : row.route === "/security" ? (loading ? "Checking…" : !available ? "Unavailable" : enabled ? "On" : "Off") : undefined}
              external={!!row.webPath} onPress={() => void open(row)} /></GuideAnchor>
          ))}
        </MenuGroup>
      ))}
      <SignOutRow />
    </MenuScreen>
  );
}
