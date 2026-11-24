import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import Animated, { cubicBezier, useReducedMotion } from "react-native-reanimated";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const EASE_OUT = cubicBezier(0.23, 1, 0.32, 1);

/** Animate the press target itself. A second flex child breaks intrinsic sizing in native ScrollViews. */
export function PressableScale({
  style, children, onPressIn, onPressOut, disabled, ...rest
}: Omit<PressableProps, "style" | "children"> & {
  style?: StyleProp<ViewStyle> | ((pressed: boolean) => StyleProp<ViewStyle>);
  children: ReactNode;
}) {
  const [pressed, setPressed] = useState(false);
  const reduced = useReducedMotion();
  const active = pressed && !disabled;
  const controlStyle = typeof style === "function" ? style(active) : style;
  const transforms = StyleSheet.flatten(controlStyle)?.transform;
  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      onPressIn={(event) => { if (!disabled) setPressed(true); onPressIn?.(event); }}
      onPressOut={(event) => { setPressed(false); onPressOut?.(event); }}
      style={[
        controlStyle,
        {
          transform: [
            ...(Array.isArray(transforms) ? transforms : []),
            { scale: active && !reduced ? 0.98 : 1 },
          ],
          transitionProperty: "transform",
          transitionDuration: reduced ? 0 : active ? 90 : 160,
          transitionTimingFunction: EASE_OUT,
        },
      ]}
    >
      {children}
    </AnimatedPressable>
  );
}
