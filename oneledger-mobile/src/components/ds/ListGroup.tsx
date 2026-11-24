import Feather from "@expo/vector-icons/Feather";
import {
  Children,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { Pressable, StyleSheet, Switch, View } from "react-native";

import { radii, space } from "@/theme/tokens";

import { Text } from "./Text";
import { IconTile } from "./BrandIcon";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

type FeatherName = React.ComponentProps<typeof Feather>["name"];

/**
 * A titled group of rows in one bordered surface, hairlines between rows: the
 * platform's grouped-list pattern, instead of a card (or a button) per row.
 */
export function ListGroup({
  title,
  footer,
  children,
  variant = "default",
}: {
  title?: string;
  footer?: string;
  children: ReactNode;
  variant?: "default" | "menu";
}) {
  const styles = useStyles();
  const rows = Children.toArray(children).filter(isValidElement) as ReactElement<{ divider?: boolean }>[];
  return (
    <View style={[styles.group, variant === "menu" && styles.menuGroup]}>
      {title ? (
        <Text variant="caption" color="textMuted" accessibilityRole="header" style={[styles.title, variant === "menu" && styles.menuTitle]}>
          {title}
        </Text>
      ) : null}
      <View style={[styles.surface, variant === "menu" && styles.menuSurface]}>
        {rows.map((row, index) => cloneElement(row, { divider: index < rows.length - 1 }))}
      </View>
      {footer ? (
        <Text variant="caption" color="textMuted" style={styles.footer}>
          {footer}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * One row: optional leading icon, a label with an optional one-line hint, an
 * optional value or badge on the right, then a chevron (or an "opens the web"
 * arrow) when it navigates. With `onToggle` it is a settings switch instead.
 * At least 48pt tall.
 */
export function ListRow({
  icon,
  label,
  hint,
  value,
  onPress,
  external = false,
  destructive = false,
  toggle,
  onToggle,
  toggleDisabled = false,
  role = "button",
  a11yLabel,
  divider = false,
  variant = "default",
  selected,
  valueBelow = false,
}: {
  icon?: FeatherName;
  label: string;
  hint?: string;
  /** Right-aligned text or a badge. */
  value?: ReactNode;
  onPress?: () => void;
  /** Shows the "opens outside the app" arrow instead of a chevron. */
  external?: boolean;
  destructive?: boolean;
  /** Current state of a switch row (use with `onToggle`). */
  toggle?: boolean;
  onToggle?: (next: boolean) => void;
  toggleDisabled?: boolean;
  role?: "button" | "link" | "radio";
  /** Overrides the spoken label (default: the label). */
  a11yLabel?: string;
  /** Set by ListGroup: draw a hairline under the row. */
  divider?: boolean;
  variant?: "default" | "menu";
  /** A selection row: renders a check instead of a navigation chevron. */
  selected?: boolean;
  /** Long account values belong under the label, rather than a narrow trailing column. */
  valueBelow?: boolean;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const menu = variant === "menu";
  const tone = destructive ? colors.danger : menu ? colors.accent : colors.textSecondary;
  const body = (
    <>
      {icon ? menu ? (
        destructive ? <View style={[styles.iconTile, { backgroundColor: colors.needsMapBg }]}><Feather name={icon} size={21} color={tone}/></View> : <IconTile name={icon}/>
      ) : <Feather name={icon} size={16} color={tone} /> : null}
      <View style={styles.text}>
        <Text variant="bodyStrong" numberOfLines={menu ? undefined : 1} style={[menu && styles.menuLabel, destructive ? { color: colors.danger } : selected ? { color: colors.accent } : undefined]}>
          {label}
        </Text>
        {hint ? (
          <Text variant="caption" color="textMuted" numberOfLines={menu ? undefined : 2} style={menu ? styles.menuHint : undefined}>
            {hint}
          </Text>
        ) : null}
        {valueBelow && typeof value === "string" ? <Text selectable variant="label" color="textSecondary" style={{ flexShrink: 1 }}>{value}</Text> : null}
      </View>
      {typeof value === "string" ? valueBelow ? null : (
        <Text variant="label" color="textMuted" numberOfLines={1} ellipsizeMode="middle" style={menu ? styles.value : undefined}>
          {value}
        </Text>
      ) : (
        value
      )}
      {external && menu ? <Text variant="caption" color="textMuted" style={styles.web}>Web</Text> : null}
      {onToggle ? (
        <Switch
          value={!!toggle}
          onValueChange={onToggle}
          disabled={toggleDisabled}
          accessibilityLabel={a11yLabel ?? label}
          trackColor={{ true: colors.accentSolid }}
          style={menu ? styles.switch : undefined}
        />
      ) : selected ? (
        <Feather name="check" size={20} color={colors.accent} />
      ) : onPress && !destructive && selected === undefined ? (
        <Feather name={external && !menu ? "external-link" : "chevron-right"} size={external && !menu ? 14 : 16} color={colors.textMuted} />
      ) : null}
      {divider && menu ? <View pointerEvents="none" style={[styles.insetDivider, { left: icon ? 58 : 16 }]} /> : null}
    </>
  );

  const frame = [styles.row, menu && styles.menuRow, divider && !menu && styles.divider];
  if (onPress) {
    return (
      <Pressable
        accessibilityRole={role}
        accessibilityLabel={a11yLabel ?? label}
        accessibilityHint={menu && external ? "Opens in your browser" : undefined}
        accessibilityState={selected !== undefined ? { selected, checked: selected } : undefined}
        onPress={onPress}
        style={({ pressed }) => [...frame, pressed && styles.pressed]}
      >
        {body}
      </Pressable>
    );
  }
  return <View style={frame}>{body}</View>;
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  group: { gap: space[1] },
  title: { textTransform: "uppercase", letterSpacing: 0.6, paddingHorizontal: space[1] },
  footer: { paddingHorizontal: space[1] },
  surface: {
    backgroundColor: colors.surface,
    borderRadius: radii.control,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: colors.borderSubtle,
    overflow: "hidden",
  },
  row: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    paddingHorizontal: space[3],
    paddingVertical: space[2],
  },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderSubtle },
  pressed: { backgroundColor: colors.accentBg },
  text: { flex: 1, gap: 1 },
  menuGroup: { gap: space[2] },
  menuTitle: { textTransform: "none", letterSpacing: 0, paddingHorizontal: space[2], fontSize: 13, lineHeight: 18 },
  menuSurface: { borderRadius: radii.card, borderWidth: StyleSheet.hairlineWidth, boxShadow: "none" },
  menuRow: { minHeight: 56, paddingHorizontal: space[4], paddingVertical: space[3] },
  menuLabel: { fontSize: 16, lineHeight: 22 },
  menuHint: { fontSize: 13, lineHeight: 18 },
  iconTile: { width: 30, height: 30, borderRadius: 9, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.borderSubtle, backgroundColor: colors.accentBg, alignItems: "center", justifyContent: "center" },
  insetDivider: { position: "absolute", right: 16, bottom: 0, height: StyleSheet.hairlineWidth, backgroundColor: colors.borderSubtle },
  value: { flexShrink: 1, maxWidth: 110 },
  web: { backgroundColor: colors.background, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 5, fontSize: 11 },
  switch: { minHeight: 44 },
}));
