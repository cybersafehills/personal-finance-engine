import { Stack } from "expo-router";
import { Platform } from "react-native";

import { PushBridge } from "@/features/push/PushBridge";
import { fonts } from "@/theme/typography";
import { useTheme } from "@/theme/ThemeProvider";

// Signed-in area: the tab shell, with detail and setup screens pushed on top.
export default function AppLayout() {
  const { colors } = useTheme();
  return (
    <>
      <PushBridge />
      <Stack
        screenOptions={{
          // Pushed screens get a native navigation header: back arrow, title and
          // the platform's own back gesture. The tab shell and the sheets/modals
          // below opt out. A screen's title comes from its ScreenHeader.
          headerShown: true,
          headerStyle: { backgroundColor: colors.surface },
          headerShadowVisible: false,
          headerTintColor: colors.accent,
          headerTitleStyle: { fontFamily: fonts.semibold, fontSize: 16, color: colors.textPrimary },
          headerBackButtonDisplayMode: "minimal",
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        {/* Screens whose body has no ScreenHeader get their title here. */}
        <Stack.Screen name="transaction/[id]" options={{ title: "Transaction" }} />
        <Stack.Screen name="category/[id]" options={{ title: "Choose a category" }} />
        <Stack.Screen name="shortcuts" options={{ title: "Record MoMo on iPhone" }} />
        <Stack.Screen name="connect" options={{ presentation: "modal", headerShown: false }} />
        {/* The Pay button's launcher: a native bottom sheet (grabber, drag to dismiss, two detents). */}
        <Stack.Screen
          name="pay-sheet"
          options={{
            presentation: "formSheet",
            headerShown: false,
            sheetGrabberVisible: true,
            // One height that fits the content (no drag between two heights: that
            // is where the layout used to tear). Android has no "fit to contents".
            sheetAllowedDetents: Platform.OS === "ios" ? "fitToContents" : [0.75],
            sheetCornerRadius: 20,
            contentStyle: { backgroundColor: colors.surface },
          }}
        />
      </Stack>
    </>
  );
}
