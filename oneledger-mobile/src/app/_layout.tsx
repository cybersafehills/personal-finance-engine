import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

// Root layout. Providers (session, lock gate, theme) are added in later PRs
// (see docs/adr/0019-expo-mobile-app.md). Keep this file thin.
export default function RootLayout() {
  return (
    <>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }} />
    </>
  );
}
