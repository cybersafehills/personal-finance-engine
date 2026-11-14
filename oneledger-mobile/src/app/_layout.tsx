import { Geist_400Regular } from "@expo-google-fonts/geist/400Regular";
import { Geist_500Medium } from "@expo-google-fonts/geist/500Medium";
import { Geist_600SemiBold } from "@expo-google-fonts/geist/600SemiBold";
import { Geist_700Bold } from "@expo-google-fonts/geist/700Bold";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

import { PrivacyProvider } from "@/features/privacy/PrivacyProvider";
import { colors } from "@/theme/tokens";

// Root layout. Session and lock-gate providers are added in PR 2
// (docs/adr/0019-expo-mobile-app.md). Keep this file thin.
export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Geist_400Regular,
    Geist_500Medium,
    Geist_600SemiBold,
    Geist_700Bold,
  });

  // Render nothing until Geist is ready so text never flashes in a fallback
  // face. On a font error, carry on with the system font rather than block.
  if (!fontsLoaded && !fontError) return null;

  return (
    <PrivacyProvider>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      />
    </PrivacyProvider>
  );
}
