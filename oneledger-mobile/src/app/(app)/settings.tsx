import * as Linking from "expo-linking";
import { router } from "expo-router";
import { useCallback, useState } from "react";
import { fetchMoreFlags } from "@/api/mobile-api";
import { Text } from "@/components/ds";
import { useLock } from "@/features/lock/LockProvider";
import { MenuGroup, MenuRow, MenuScreen, ProfileSummary, SignOutRow } from "@/features/settings/MenuUI";
import { visibleSettingsGroups, type SettingsRow } from "@/features/settings/groups";
import { useQuery } from "@/hooks/useQuery";
import { config } from "@/lib/config";
import { useTheme } from "@/theme/ThemeProvider";

export default function Settings() {
  const { preference } = useTheme();
  const { enabled, available, loading } = useLock();
  const load = useCallback(() => fetchMoreFlags(), []);
  const { data: flags } = useQuery(load);
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
            <MenuRow key={row.label} role="link" icon={row.icon} label={row.label}
              value={row.route === "/appearance" ? (preference === "system" ? "Automatic" : preference === "dark" ? "Dark" : "Light") : row.route === "/security" ? (loading ? "Checking…" : !available ? "Unavailable" : enabled ? "On" : "Off") : undefined}
              external={!!row.webPath} onPress={() => void open(row)} />
          ))}
        </MenuGroup>
      ))}
      <SignOutRow />
    </MenuScreen>
  );
}
