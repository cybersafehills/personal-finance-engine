import Feather from "@expo/vector-icons/Feather";
import { Tabs } from "expo-router";

import { AppHeader } from "@/components/shell/AppHeader";
import { fonts } from "@/theme/typography";
import { useTheme } from "@/theme/ThemeProvider";

type IconName = React.ComponentProps<typeof Feather>["name"];

const icon = (name: IconName) => {
  // Coloured from our own tokens (matching the tab bar's tint settings)
  // rather than the navigator's loosely-typed colour value.
  function TabIcon({ focused }: { focused: boolean }) {
    const { colors } = useTheme();
    return (
      <Feather
        name={name}
        size={20}
        color={focused ? colors.accent : colors.textMuted}
      />
    );
  }
  return TabIcon;
};

export default function TabsLayout() {
  const { colors } = useTheme();
  return (
    <Tabs
      // The dock floats above the screens and reserves no space, so content scrolls behind its glass.
      tabBar={() => null}
      screenOptions={{
        headerShown: true,
        header: () => <AppHeader />,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: { fontFamily: fonts.medium, fontSize: 11 },
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.borderSubtle,
        },
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Home", headerShown: false, tabBarIcon: icon("home") }} />
      <Tabs.Screen
        name="transactions"
        options={{ title: "Transactions", tabBarIcon: icon("list") }}
      />
      <Tabs.Screen name="pay" options={{title:"Pay",href:null}}/>
      {/* Inbox is opened from the header icon (as on the web), not the bar. Hidden with
          tabBarButton, not href: null: with href: null the router bounced /inbox straight
          back to Home on Android (the screen never rendered). MotionTabBar draws its own
          fixed tabs, so this only matters for any default bar. */}
      <Tabs.Screen name="inbox" options={{ title: "Inbox", tabBarButton: () => null }} />
      <Tabs.Screen name="plan" options={{ title: "Plan", tabBarIcon: icon("target") }} />
      <Tabs.Screen name="more" options={{ title: "More", headerShown: false, tabBarIcon: icon("grid") }} />
    </Tabs>
  );
}
