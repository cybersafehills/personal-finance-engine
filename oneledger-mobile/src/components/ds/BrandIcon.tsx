import { useId, type ComponentProps } from "react";
import Feather from "@expo/vector-icons/Feather";
import { StyleSheet, View } from "react-native";
import Svg, { Defs, LinearGradient, Stop, Rect, Path, Circle, G } from "react-native-svg";
import { useTheme } from "@/theme/ThemeProvider";
import { contrastRatio } from "@/theme/contrast";

type IconName = ComponentProps<typeof Feather>["name"];
// Anything not listed (home, globe, link, code, layout…) intentionally takes the brand violet.
// Semantic families keep the same meaning in menus, settings and service shortcuts.
export function iconGradient(name: IconName, colors: ReturnType<typeof useTheme>["colors"]): readonly [string, string] {
  if (["dollar-sign", "download", "trending-up", "check-circle", "repeat", "credit-card", "send", "plus-circle", "file-text", "copy", "pie-chart", "bar-chart-2"].includes(name)) return [colors.iconMoneyStart, colors.iconMoneyEnd];
  if (["book-open", "zap", "star", "award", "target", "flag", "calendar", "sun"].includes(name)) return [colors.iconLearningStart, colors.iconLearningEnd];
  if (["mail", "message-circle", "heart", "gift", "bell", "smartphone", "users", "user", "inbox"].includes(name)) return [colors.iconCommunicationStart, colors.iconCommunicationEnd];
  if (["settings", "lock", "shield", "help-circle", "log-out", "eye"].includes(name)) return [colors.iconNeutralStart, colors.iconNeutralEnd];
  return [colors.homeGradientStart, colors.homeGradientEnd];
}
/** Glyph colour for a bare icon on the page/surface: the family colour end that reads best in the current theme. */
export function iconInk(name: IconName, colors: ReturnType<typeof useTheme>["colors"]): string {
  const [start, end] = iconGradient(name, colors);
  return contrastRatio(start, colors.surface) >= contrastRatio(end, colors.surface) ? start : end;
}
/** Darkens "#rrggbb" toward black by `amount` (0..1). */
export function shade(hex: string, amount: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const part = (shift: number) => Math.round(((n >> shift) & 255) * (1 - amount)).toString(16).padStart(2, "0");
  return `#${part(16)}${part(8)}${part(0)}`;
}
/** `deep` gives the richer, darker version of the family colour (service shortcuts). */
export function IconTile({ name, size = 32, deep = false }: { name: IconName; size?: number; deep?: boolean }) {
  const id = `tile-${useId().replace(/:/g, "")}`;
  const { colors } = useTheme();
  const family = iconGradient(name, colors);
  const [start, end] = deep ? [shade(family[0], 0.38), shade(family[1], 0.4)] : family;
  return <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
    <Svg width={size} height={size} style={StyleSheet.absoluteFill} accessible={false} pointerEvents="none">
      <Defs><LinearGradient id={id} x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor={start}/><Stop offset="1" stopColor={end}/></LinearGradient></Defs>
      <Rect width={size} height={size} rx={size * 0.29} fill={`url(#${id})`}/>
      <Path d={`M 7 1 H ${size - 7}`} stroke={colors.onSolid} strokeOpacity={0.2}/>
    </Svg>
    <Feather name={name} size={size * 0.58} color={colors.onSolid}/>
  </View>;
}

/** Gradient follows the actual icon strokes, using the balance card's brand tokens. */
export function BrandNavIcon({ name, selected }: { name: "home" | "list" | "target" | "grid"; selected: boolean }) {
  const { colors } = useTheme();
  const id = `nav-${useId().replace(/:/g, "")}`;
  const stroke = selected ? `url(#${id})` : colors.textPrimary;
  return <Svg width={24} height={24} viewBox="0 0 24 24" accessible={false} pointerEvents="none">
    <Defs><LinearGradient id={id} x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor={colors.navIconStart}/><Stop offset="1" stopColor={colors.navIconEnd}/></LinearGradient></Defs>
    <G fill="none" stroke={stroke} strokeWidth={2.3} strokeLinecap="round" strokeLinejoin="round">
      {name === "home" ? <Path d="M3 10 12 3 21 10V21H15V14H9V21H3Z"/> : null}
      {name === "list" ? <><Path d="M9 5H21M9 12H21M9 19H21"/><Circle cx={3} cy={5} r={0.8}/><Circle cx={3} cy={12} r={0.8}/><Circle cx={3} cy={19} r={0.8}/></> : null}
      {name === "target" ? <><Circle cx={12} cy={12} r={9}/><Circle cx={12} cy={12} r={5}/><Circle cx={12} cy={12} r={1}/></> : null}
      {name === "grid" ? <><Rect x={3} y={3} width={6} height={6} rx={0.5}/><Rect x={15} y={3} width={6} height={6} rx={0.5}/><Rect x={3} y={15} width={6} height={6} rx={0.5}/><Rect x={15} y={15} width={6} height={6} rx={0.5}/></> : null}
    </G>
  </Svg>;
}
