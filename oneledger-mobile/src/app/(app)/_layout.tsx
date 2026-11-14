import { Stack } from "expo-router";

import { colors } from "@/theme/tokens";

// Signed-in area. Becomes the tab shell in PR 5.
export default function AppLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    />
  );
}
