import Feather from "@expo/vector-icons/Feather";
import { Tabs } from "expo-router";

import { AppHeader } from "@/components/shell/AppHeader";
import { colors } from "@/theme/tokens";
import { fonts } from "@/theme/typography";

type IconName = React.ComponentProps<typeof Feather>["name"];

const icon = (name: IconName) => {
  // Coloured from our own tokens (matching the tab bar's tint settings)
  // rather than the navigator's loosely-typed colour value.
  function TabIcon({ focused }: { focused: boolean }) {
    return (
      <Feather
        name={name}
        size={22}
        color={focused ? colors.accent : colors.textMuted}
      />
    );
  }
  return TabIcon;
};

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        header: () => <AppHeader />,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: { fontFamily: fonts.medium, fontSize: 12 },
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.borderSubtle,
        },
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Home", tabBarIcon: icon("home") }} />
      <Tabs.Screen
        name="transactions"
        options={{ title: "Transactions", tabBarIcon: icon("list") }}
      />
      {/* Inbox is opened from the header icon (as on the web), not the bar. */}
      <Tabs.Screen name="inbox" options={{ title: "Inbox", href: null }} />
      <Tabs.Screen name="plan" options={{ title: "Plan", tabBarIcon: icon("target") }} />
      <Tabs.Screen name="more" options={{ title: "More", tabBarIcon: icon("menu") }} />
    </Tabs>
  );
}
