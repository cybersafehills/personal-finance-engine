import Feather from "@expo/vector-icons/Feather";
import { router, Tabs } from "expo-router";
import { useCallback } from "react";

import { fetchPayConfig } from "@/api/mobile-api";
import { PayTabButton } from "@/components/shell/PayTabButton";
import { setPayConfigCache } from "@/features/pay/config-cache";
import { holdHint, resolveHoldTarget } from "@/features/pay/hold-action";
import { useHoldPrefs } from "@/features/pay/hold-store";
import { showPayButton } from "@/features/pay/launcher";
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
        size={20}
        color={focused ? colors.accent : colors.textMuted}
      />
    );
  }
  return TabIcon;
};

export default function TabsLayout() {
  const loadPay = useCallback(async () => {
    const result = await fetchPayConfig();
    // The sheet reads this so it can open instantly.
    setPayConfigCache(result.ok ? result : null);
    return result;
  }, []);
  const { data: payConfig } = useQuery(loadPay);
  // Shown only where Pay is on; while that is unknown, or if it can't be read, there is no button.
  const payOn = payConfig ? showPayButton(payConfig) : false;
  // What holding the button does (Scan to pay unless the user chose otherwise).
  const holdPrefs = useHoldPrefs();
  const readyConfig = payConfig?.ok ? payConfig : null;
  const holdTarget = resolveHoldTarget(holdPrefs, readyConfig);

  return (
    <Tabs
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
      <Tabs.Screen name="index" options={{ title: "Home", tabBarIcon: icon("home") }} />
      <Tabs.Screen
        name="transactions"
        options={{ title: "Transactions", tabBarIcon: icon("list") }}
      />
      <Tabs.Screen
        name="pay"
        // expo-router throws if `href` and `tabBarButton` are both set, so a
        // hidden Pay tab (Pay off, or its config still loading) gets only
        // `href: null`, and a visible one only the custom centre button.
        options={
          payOn
            ? { title: "Pay", tabBarButton: () => (
                <PayTabButton
                  onPress={() => router.push("/pay-sheet")}
                  onHold={holdTarget ? () => router.push(holdTarget) : undefined}
                  holdMs={holdPrefs.durationMs}
                  hint={holdHint(holdPrefs, readyConfig)}
                />
              ),
            }
            : { title: "Pay", href: null }
        }
      />
      {/* Inbox is opened from the header icon (as on the web), not the bar. */}
      <Tabs.Screen name="inbox" options={{ title: "Inbox", href: null }} />
      <Tabs.Screen name="plan" options={{ title: "Plan", tabBarIcon: icon("target") }} />
      <Tabs.Screen name="more" options={{ title: "More", tabBarIcon: icon("menu") }} />
    </Tabs>
  );
}
