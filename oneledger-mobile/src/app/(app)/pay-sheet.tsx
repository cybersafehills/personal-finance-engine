import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";

import { fetchPayConfig } from "@/api/mobile-api";
import { PayLauncher } from "@/components/shell/PayLauncher";
import { Text } from "@/components/ds";
import type { PayConfig } from "@/features/pay/types";
import { getFavourites } from "@/features/ussd/queries";
import { colors } from "@/theme/tokens";
import { View } from "react-native";

type Favourite = { slug: string; name: string; template: string };

// The centre Pay button's sheet. It is a route presented as a native form sheet
// (see (app)/_layout.tsx), so it has the platform's grabber, drag-to-dismiss and
// detents instead of a hand-built dialog.
export default function PaySheet() {
  const [config, setConfig] = useState<Partial<PayConfig> | null>(null);
  const [favourite, setFavourite] = useState<Favourite | null>(null);

  useEffect(() => {
    let active = true;
    fetchPayConfig()
      .then((result) => {
        if (!active) return;
        const next = result.ok ? result : {};
        setConfig(next);
        // The favourite loads after the sheet is already open; a failure just means no favourite line.
        if (result.ok && result.ussdDirectory) {
          getFavourites()
            .then((list) => active && setFavourite(list[0] ? { slug: list[0].slug, name: list[0].name, template: list[0].template } : null))
            .catch(() => undefined);
        }
      })
      .catch(() => active && setConfig({}));
    return () => {
      active = false;
    };
  }, []);

  const close = useCallback(() => router.back(), []);

  if (!config) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.surface, padding: 16 }}>
        <Text variant="label" color="textMuted" accessibilityRole="alert">
          Loading…
        </Text>
      </View>
    );
  }
  return <PayLauncher config={config} favourite={favourite} onClose={close} />;
}
