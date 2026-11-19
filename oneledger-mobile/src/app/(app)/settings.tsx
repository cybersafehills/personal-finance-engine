import * as Linking from "expo-linking";
import { router } from "expo-router";
import { useCallback } from "react";

import { fetchMoreFlags } from "@/api/mobile-api";
import { ListGroup, ListRow, Screen, ScreenHeader } from "@/components/ds";
import { visibleSettingsGroups, type SettingsRow } from "@/features/settings/groups";
import { useQuery } from "@/hooks/useQuery";
import { config } from "@/lib/config";

// Settings, grouped like the web's. Rows with a native screen open it; the
// rest open the web page (marked with the "opens outside the app" arrow; the
// browser may ask you to sign in once).
export default function Settings() {
  const load = useCallback(() => fetchMoreFlags(), []);
  const { data: flags } = useQuery(load);
  function open(row: SettingsRow) {
    if (row.route) router.push(row.route);
    else if (row.webPath) Linking.openURL(`${config.apiBaseUrl}${row.webPath}`);
  }

  return (
    <Screen>
      <ScreenHeader title="Settings" />
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
