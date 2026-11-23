import { GuideAnchor } from "@/features/guides/GuideAnchor";
import { BrandNavIcon } from "@/components/ds/BrandIcon";
import { router, Tabs, usePathname } from "expo-router";
import type { ComponentProps } from "react";
import { StyleSheet, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { useAnimatedStyle, useReducedMotion } from "react-native-reanimated";
import { Text } from "@/components/ds/Text";
import { PressableScale } from "@/components/ds/PressableScale";
import { useTheme } from "@/theme/ThemeProvider";
import { withAlpha } from "@/theme/alpha";
import { DOCK_BODY, dockBottomGap } from "./dockClearance";
import { useNavigationChrome } from "./NavigationChromeContext";

type TabProps = Parameters<NonNullable<ComponentProps<typeof Tabs>["tabBar"]>>[0];
/** Narrowest comfortable dock: ~60pt per slot plus a little padding, never wider than the full dock. */
export const tightDockWidth = (full: number, payOn: boolean) => Math.min(full, (payOn ? 5 : 4) * 60 + 20);
const routes = [
  { name: "index", label: "Home", icon: "home", home: 0 },
  { name: "transactions", label: "Transactions", icon: "list", home: 1 },
  { name: "plan", label: "Plan", icon: "target", home: 3 },
  { name: "more", label: "More", icon: "grid", home: 4 },
] as const;

/** An inset dock reserves space in the navigator, so content stays above it. */
export function MotionTabBar(props: Partial<TabProps> = {}) {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // Computed here: a plain function cannot be called from inside an animated style.
  const gap = dockBottomGap(insets.bottom);
  const { compactProgress, keyboardHeight, payOn } = useNavigationChrome();
  const horizontal = Math.max(12, insets.left, insets.right);
  const dockWidth = width - horizontal * 2;
  const tightWidth = tightDockWidth(dockWidth, payOn);
  const frameStyle = useAnimatedStyle(() => ({
    height: keyboardHeight > 0 ? 0 : DOCK_BODY - 8 * (compactProgress?.get() ?? 0) + gap,
    opacity: keyboardHeight > 0 ? 0 : 1,
  }));
  // As the labels fold away the dock hugs its icons: narrower, centred, same pill shape.
  const dockStyle = useAnimatedStyle(() => {
    const c = compactProgress?.get() ?? 0;
    const w = dockWidth + (tightWidth - dockWidth) * c;
    return { height: 64 - 8 * c, width: w, left: horizontal + (dockWidth - w) / 2 };
  });
  return (
    <Animated.View pointerEvents={keyboardHeight > 0 ? "none" : "box-none"} accessibilityLabel="Main navigation" style={frameStyle}>
      <Animated.View style={[styles.dock, {
        // Mostly solid with a hint of see-through, so content passing behind is only faintly visible.
        backgroundColor: withAlpha(colors.surface, 0.9),
        borderColor: colors.borderSubtle,
        boxShadow: "0 4px 16px rgba(0, 0, 0, 0.10)",
      }, dockStyle]}>
        {routes.map((item, position) => (
          <MotionTab key={item.name} item={item} position={position} dockWidth={dockWidth} tightWidth={tightWidth} navigation={props.state ? props as TabProps : undefined} />
        ))}
      </Animated.View>
    </Animated.View>
  );
}

function MotionTab({ item, position, dockWidth, tightWidth, navigation }: {
  item: typeof routes[number]; position: number; dockWidth: number; tightWidth: number; navigation?: TabProps;
}) {
  const { colors } = useTheme();
  const { compactProgress, awayProgress, payOn, compact } = useNavigationChrome();
  const path = usePathname();
  const reduced = useReducedMotion();
  const route = navigation?.state.routes.find(r => r.name === item.name);
  const focused = navigation ? navigation.state.routes[navigation.state.index]?.name === item.name : path === (item.name === "index" ? "/" : `/${item.name}`);
  const width = dockWidth / (payOn ? 5 : 4);
  const positionStyle = useAnimatedStyle(() => {
    const away = payOn ? (awayProgress?.get() ?? 0) : 0;
    const c = compactProgress?.get() ?? 0;
    const liveWidth = dockWidth + (tightWidth - dockWidth) * c;
    const normalWidth = liveWidth / (payOn ? 5 : 4);
    const detailWidth = liveWidth / 4;
    return {
      width: normalWidth + (detailWidth - normalWidth) * away,
      left: normalWidth * (payOn ? item.home : position) * (1 - away) + detailWidth * position * away,
    };
  });
  const labelStyle = useAnimatedStyle(() => ({
    opacity: 1 - (compactProgress?.get() ?? 0),
    height: 14 * (1 - (compactProgress?.get() ?? 0)),
  }));
  if (navigation && !route) return null;
  return (
    <Animated.View testID={`nav-position-${item.name}`} style={[{ position: "absolute", top: 10 }, positionStyle]}>
      <GuideAnchor persistent id={`nav-${item.name}`}>
        <PressableScale
          accessibilityRole="tab"
          accessibilityLabel={item.label}
          accessibilityState={{ selected: focused }}
          aria-selected={focused}
          onPress={() => {
            if (navigation && route) {
              const event = navigation.emitter.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
              if (!focused && !event.defaultPrevented) navigation.navigateToTab(route.key);
            } else {
              router.navigate(item.name === "index" ? "/" : `/${item.name}`);
            }
          }}
          onLongPress={() => { if (navigation && route) navigation.emitter.emit({ type: "tabLongPress", target: route.key }); }}
          style={{ minHeight: 44, alignItems: "center", justifyContent: "center", gap: 4 }}
        >
          <Animated.View style={{
            borderRadius: 12, width: 40, height: 26, alignItems: "center", justifyContent: "center",
            backgroundColor: focused ? colors.navSelectedBg : colors.surface,
            transform: [{ translateY: focused && !reduced ? -1 : 0 }],
            transitionProperty: ["backgroundColor", "transform"], transitionDuration: reduced ? 0 : 160,
          }}>
            <BrandNavIcon name={item.icon} selected={focused} />
          </Animated.View>
          <Animated.View style={labelStyle} accessibilityElementsHidden={compact}>
            <Text variant="caption" style={{ fontSize: 10, lineHeight: 14 }} color={focused ? "navSelectedInk" : "textPrimary"}>{item.name === "transactions" && width < 70 ? "Activity" : item.label}</Text>
          </Animated.View>
        </PressableScale>
      </GuideAnchor>
    </Animated.View>
  );
}
const styles = StyleSheet.create({
  dock: { position: "absolute", top: 8, borderRadius: 22, borderCurve: "continuous", borderWidth: StyleSheet.hairlineWidth },
});

/** Tabs reserve the same space; the visible dock persists above the signed-in Stack. */
export function NavigationDockSpacer() {
  const insets = useSafeAreaInsets();
  const gap = dockBottomGap(insets.bottom);
  const { compactProgress, keyboardHeight } = useNavigationChrome();
  const style = useAnimatedStyle(() => ({ height: keyboardHeight > 0 ? 0 : DOCK_BODY - 8 * (compactProgress?.get() ?? 0) + gap }));
  return <Animated.View pointerEvents="none" style={style} />;
}
