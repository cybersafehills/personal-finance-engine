import { useState, type ReactNode } from "react";
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import Animated, { cubicBezier, useReducedMotion } from "react-native-reanimated";

// Press feedback for button-like controls: a quick scale to 0.97 on press-in that
// springs back on release, driven by a Reanimated CSS transition (UI thread, no
// re-render per frame). Feedback on press-in, not on release, so it feels instant.
// Full-width list rows should highlight their background instead (a scaling row
// reads as the whole screen squishing), so those don't use this.

const EASE_OUT = cubicBezier(0.23, 1, 0.32, 1);

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
  const visual = typeof style === "function" ? style(pressed) : style;
  return (
    <Pressable
      {...rest}
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
