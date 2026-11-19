import { usePrivacy } from "@/features/privacy/PrivacyProvider";
import * as Linking from "expo-linking";
import { router } from "expo-router";
import { useCallback } from "react";

import { fetchMoreFlags } from "@/api/mobile-api";
import { Button, Card, ListGroup, ListRow, Screen, ScreenHeader, Text } from "@/components/ds";
import { visibleSettingsGroups, type SettingsRow } from "@/features/settings/groups";
import { useQuery } from "@/hooks/useQuery";
import { config } from "@/lib/config";

// Settings, grouped like the web's. Rows with a native screen open it; the
// rest open the web page (marked with the "opens outside the app" arrow; the
// browser may ask you to sign in once).
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
        <ListGroup key={group.title} title={group.title} footer={group.description}>
          {group.rows.map((row) => (
            <ListRow
              key={row.label}
              role="link"
              label={row.label}
              hint={row.description}
              external={!!row.webPath}
              onPress={() => open(row)}
            />
          ))}
        </ListGroup>
      ))}
    </Screen>
  );
}
