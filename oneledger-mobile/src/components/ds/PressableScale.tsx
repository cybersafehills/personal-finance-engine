import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import Animated, { cubicBezier, useReducedMotion } from "react-native-reanimated";

// Press feedback for button-like controls: a quick scale to 0.97 on press-in that
// springs back on release, driven by a Reanimated CSS transition (UI thread, no
// re-render per frame). Feedback on press-in, not on release, so it feels instant.
// Full-width list rows should highlight their background instead (a scaling row
// reads as the whole screen squishing), so those don't use this.
//
// The caller's style describes the control exactly as if it were a plain View.
// Internally the press target and the visual are two views, so the layout keys
// (how wide it is in its parent) must stay on the OUTER press target, and only the
// look goes on the inner view that scales; `splitStyle` does that split.

const EASE_OUT = cubicBezier(0.23, 1, 0.32, 1);

/** The style keys that decide how big a control is inside its parent. */
const LAYOUT_KEYS = [
  "flex",
  "flexBasis",
  "flexGrow",
  "flexShrink",
  "width",
  "minWidth",
  "maxWidth",
  "alignSelf",
  "margin",
  "marginTop",
  "marginBottom",
  "marginLeft",
  "marginRight",
  "marginHorizontal",
  "marginVertical",
] as const;

export function splitStyle(style: StyleProp<ViewStyle>): { layout: ViewStyle; visual: ViewStyle } {
  const flat = (StyleSheet.flatten(style) ?? {}) as Record<string, unknown>;
  const layout: Record<string, unknown> = {};
  const visual: Record<string, unknown> = { ...flat };
  for (const key of LAYOUT_KEYS) {
    if (key in flat) {
      layout[key] = flat[key];
      delete visual[key];
    }
  }
  return { layout: layout as ViewStyle, visual: visual as ViewStyle };
}

export function PressableScale({
  style,
  children,
  onPressIn,
  onPressOut,
  ...rest
}: Omit<PressableProps, "style" | "children"> & {
  /** The visual container; receives whether the control is pressed (for border/background changes). */
  style?: StyleProp<ViewStyle> | ((pressed: boolean) => StyleProp<ViewStyle>);
  children: ReactNode;
}) {
  const [pressed, setPressed] = useState(false);
  const reduced = useReducedMotion();
  const { layout, visual } = splitStyle(typeof style === "function" ? style(pressed) : style);
  return (
    <Pressable
      {...rest}
      style={layout}
      onPressIn={(e) => {
        setPressed(true);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        setPressed(false);
        onPressOut?.(e);
      }}
    >
      <Animated.View
        style={[
          visual,
          // Fill the press target: it is sized by the layout keys above.
          { flex: 1 },
          {
            transform: [{ scale: pressed && !reduced ? 0.97 : 1 }],
            transitionProperty: "transform",
            transitionDuration: reduced ? 0 : pressed ? 100 : 160,
            transitionTimingFunction: EASE_OUT,
          },
        ]}
      >
        {children}
      </Animated.View>
    </Pressable>
  );
}
