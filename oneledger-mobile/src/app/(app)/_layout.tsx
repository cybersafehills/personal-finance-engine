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
        {/* The Pay button's launcher: a native bottom sheet (grabber, drag to dismiss, two detents). */}
        <Stack.Screen
          name="pay-sheet"
          options={{
            presentation: "formSheet",
            sheetGrabberVisible: true,
            sheetAllowedDetents: [0.7, 1],
            sheetCornerRadius: 20,
            contentStyle: { backgroundColor: colors.surface },
          }}
        />
      </Stack>
    </>
  );
}
