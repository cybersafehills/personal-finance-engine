import Feather from "@expo/vector-icons/Feather";
import { Tabs } from "expo-router";
import { useCallback, useState } from "react";

import { fetchPayConfig } from "@/api/mobile-api";
import { PaySheet } from "@/components/shell/PaySheet";
import { PayTabButton } from "@/components/shell/PayTabButton";
import { showPayButton } from "@/features/pay/launcher";
import { getFavourites } from "@/features/ussd/queries";
import { useQuery } from "@/hooks/useQuery";
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
  const [payOpen, setPayOpen] = useState(false);
  const [favourite, setFavourite] = useState<{ slug: string; name: string; template: string } | null>(null);
  const loadPay = useCallback(() => fetchPayConfig(), []);
  const { data: payConfig } = useQuery(loadPay);
  // Shown only where Pay is on; while that is unknown, or if it can't be read, there is no button.
  const payOn = payConfig ? showPayButton(payConfig) : false;

  // The favourite is fetched from the same tap that opens the sheet, so it is in
  // flight while the sheet slides in. A failure just means no favourite line.
  function openPay() {
    setPayOpen(true);
    if (payConfig?.ok && payConfig.ussdDirectory) {
      getFavourites()
        .then((list) => setFavourite(list[0] ? { slug: list[0].slug, name: list[0].name, template: list[0].template } : null))
        .catch(() => setFavourite(null));
    }
  }

  return (
    <>
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
      <Tabs.Screen
        name="pay"
        options={{
          title: "Pay",
          href: payOn ? undefined : null,
          tabBarButton: () => <PayTabButton onPress={openPay} />,
        }}
      />
      {/* Inbox is opened from the header icon (as on the web), not the bar. */}
      <Tabs.Screen name="inbox" options={{ title: "Inbox", href: null }} />
      <Tabs.Screen name="plan" options={{ title: "Plan", tabBarIcon: icon("target") }} />
      <Tabs.Screen name="more" options={{ title: "More", tabBarIcon: icon("menu") }} />
    </Tabs>
    <PaySheet open={payOpen} onClose={() => setPayOpen(false)} config={payConfig && payConfig.ok ? payConfig : {}} favourite={favourite} />
    </>
  );
}
