import { Geist_400Regular } from "@expo-google-fonts/geist/400Regular";
import { Geist_500Medium } from "@expo-google-fonts/geist/500Medium";
import { Geist_600SemiBold } from "@expo-google-fonts/geist/600SemiBold";
import { Geist_700Bold } from "@expo-google-fonts/geist/700Bold";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

import { SessionProvider, useSession } from "@/features/auth/SessionProvider";
import { LockProvider, useLock } from "@/features/lock/LockProvider";
import { LockScreen } from "@/features/lock/LockScreen";
import { PrivacyProvider } from "@/features/privacy/PrivacyProvider";
import { colors } from "@/theme/tokens";

// Which screens exist depends on the session:
//   signed out            -> sign-in
//   signed in, owes MFA   -> mfa
//   signed in             -> (app)
// The lock screen is an overlay rather than a route so the navigation
// state underneath survives a lock/unlock.
function RootNavigator() {
  const { loading, session, mfaRequired } = useSession();
  const lock = useLock();

  if (loading || lock.loading) return null;

  const signedIn = !!session;

  return (
    <>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Protected guard={signedIn && !mfaRequired}>
          <Stack.Screen name="(app)" />
        </Stack.Protected>
        <Stack.Protected guard={signedIn && mfaRequired}>
          <Stack.Screen name="mfa" />
        </Stack.Protected>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="sign-in" />
        </Stack.Protected>
      </Stack>
      {signedIn && lock.locked ? (
        <LockScreen mode="locked" />
      ) : signedIn && lock.obscured ? (
        <LockScreen mode="cover" />
      ) : null}
    </>
  );
}

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
    <SessionProvider>
      <LockProvider>
        <PrivacyProvider>
          <StatusBar style="dark" />
          <RootNavigator />
        </PrivacyProvider>
      </LockProvider>
    </SessionProvider>
  );
}
