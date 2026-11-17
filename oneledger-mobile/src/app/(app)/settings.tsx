import * as Linking from "expo-linking";
import { router } from "expo-router";
import { useCallback } from "react";
import { Pressable, View } from "react-native";

import { fetchMoreFlags } from "@/api/mobile-api";
import { Button, Card, Screen, ScreenHeader, Text } from "@/components/ds";
import { visibleSettingsGroups, type SettingsRow } from "@/features/settings/groups";
import { useQuery } from "@/hooks/useQuery";
import { config } from "@/lib/config";
import { colors, space } from "@/theme/tokens";

// Settings, grouped like the web's. Rows with a native screen open it; the
// rest open the web page (the browser may ask you to sign in once).
export default function Settings() {
  const load = useCallback(() => fetchMoreFlags(), []);
  const { data: flags } = useQuery(load);
  function open(row: SettingsRow) {
    if (row.route) router.push(row.route);
    else if (row.webPath) Linking.openURL(`${config.apiBaseUrl}${row.webPath}`);
  }

  return (
    <Screen>
      <Button label="Back" variant="ghost" onPress={() => router.back()} />
      <ScreenHeader title="Settings" />
      {visibleSettingsGroups(flags ?? null).map((group) => (
        <View key={group.title} style={{ gap: space[2] }}>
          <Text variant="bodyStrong" accessibilityRole="header">
            {group.title}
          </Text>
          <Text variant="caption" color="textMuted">
            {group.description}
          </Text>
          <Card style={{ paddingVertical: 0 }}>
            {group.rows.map((row, index) => (
              <Pressable
                key={row.label}
                accessibilityRole="link"
                accessibilityLabel={row.label}
                onPress={() => open(row)}
                style={{
                  minHeight: 56,
                  justifyContent: "center",
                  paddingVertical: space[3],
                  borderTopWidth: index === 0 ? 0 : 1,
                  borderTopColor: colors.borderSubtle,
                }}
              >
                <Text variant="bodyStrong">{row.label}</Text>
                <Text variant="caption" color="textMuted">
                  {row.description}
                  {row.webPath ? " Opens on the web." : ""}
                </Text>
              </Pressable>
            ))}
          </Card>
        </View>
      ))}
    </Screen>
  );
}
