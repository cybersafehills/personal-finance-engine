import { usePrivacy } from "@/features/privacy/PrivacyProvider";
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
  const privacy = usePrivacy();
  const load = useCallback(() => fetchMoreFlags(), []);
  const { data: flags } = useQuery(load);
  function open(row: SettingsRow) {
    if (row.route) router.push(row.route);
    else if (row.webPath) Linking.openURL(`${config.apiBaseUrl}${row.webPath}`);
  }

  return (
    <Screen>
      <ScreenHeader title="Settings" />
      <Card>
        <Text variant="bodyStrong">Full financial privacy</Text>
        <Text variant="caption">Hide amounts on financial screens, including their screen-reader labels.</Text>
        <Button label={privacy.fullPrivacy ? "Turn off full privacy" : "Turn on full privacy"} onPress={() => privacy.setFullPrivacy(!privacy.fullPrivacy)} />
        {privacy.saveError ? <Text accessibilityRole="alert">{privacy.saveError}</Text> : null}
      </Card>
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
                  borderTopColor: colors.borderSubtle }}
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
