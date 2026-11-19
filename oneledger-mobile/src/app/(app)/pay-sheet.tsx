import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";

import { fetchPayConfig } from "@/api/mobile-api";
import { PayLauncher } from "@/components/shell/PayLauncher";
import { Text } from "@/components/ds";
import { getPayConfigCache, setPayConfigCache } from "@/features/pay/config-cache";
import type { PayConfig } from "@/features/pay/types";
import { colors } from "@/theme/tokens";

// The centre Pay button's sheet: a route presented as a native form sheet (see
// (app)/_layout.tsx) with the platform's grabber and drag-to-dismiss. It draws at
// once from the config the tab shell already read; a request only happens in the
// unlikely case that cache is empty.
export default function PaySheet() {
  const [config, setConfig] = useState<Partial<PayConfig> | null>(getPayConfigCache);

  useEffect(() => {
    if (config) return;
    let active = true;
    fetchPayConfig()
      .then((result) => {
        const next = result.ok ? result : {};
        setPayConfigCache(next);
        if (active) setConfig(next);
      })
      .catch(() => active && setConfig({}));
    return () => {
      active = false;
    };
  }, [config]);

  const close = useCallback(() => router.back(), []);

  if (!config) {
    return (
      <View style={{ backgroundColor: colors.surface, padding: 16 }}>
        <Text variant="label" color="textMuted" accessibilityRole="alert">
          Loading…
        </Text>
      </View>
    );
  }
  return <PayLauncher config={config} onClose={close} />;
}
