import { Stack } from "expo-router";

import { PushBridge } from "@/features/push/PushBridge";
import { colors } from "@/theme/tokens";

// Signed-in area: the tab shell, with detail and setup screens pushed on top.
export default function AppLayout() {
  return (
    <>
      <PushBridge />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="connect" options={{ presentation: "modal" }} />
      </Stack>
    </>
  );
}
