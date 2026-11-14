import Feather from "@expo/vector-icons/Feather";
import { Tabs } from "expo-router";

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
        headerShown: false,
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
      <Tabs.Screen
        name="review"
        options={{ title: "To review", tabBarIcon: icon("inbox") }}
      />
      <Tabs.Screen name="more" options={{ title: "More", tabBarIcon: icon("menu") }} />
    </Tabs>
  );
}
