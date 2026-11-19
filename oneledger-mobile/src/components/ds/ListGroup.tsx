import Feather from "@expo/vector-icons/Feather";
import {
  Children,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { Pressable, StyleSheet, Switch, View } from "react-native";

import { colors, radii, space } from "@/theme/tokens";

import { Text } from "./Text";

type FeatherName = React.ComponentProps<typeof Feather>["name"];

/**
 * A titled group of rows in one bordered surface, hairlines between rows: the
 * platform's grouped-list pattern, instead of a card (or a button) per row.
 */
export function ListGroup({
  title,
  footer,
  children,
}: {
  title?: string;
  footer?: string;
  children: ReactNode;
}) {
  const rows = Children.toArray(children).filter(isValidElement) as ReactElement<{ divider?: boolean }>[];
  return (
    <View style={styles.group}>
      {title ? (
        <Text variant="caption" color="textMuted" accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
      ) : null}
      <View style={styles.surface}>
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
  role?: "button" | "link";
  /** Overrides the spoken label (default: the label). */
  a11yLabel?: string;
  /** Set by ListGroup: draw a hairline under the row. */
  divider?: boolean;
}) {
  const tone = destructive ? colors.notificationBadge : colors.textSecondary;
  const body = (
    <>
      {icon ? <Feather name={icon} size={16} color={tone} /> : null}
      <View style={styles.text}>
        <Text variant="bodyStrong" numberOfLines={1} style={destructive ? { color: colors.notificationBadge } : undefined}>
          {label}
        </Text>
        {hint ? (
          <Text variant="caption" color="textMuted" numberOfLines={2}>
            {hint}
          </Text>
        ) : null}
      </View>
      {typeof value === "string" ? (
        <Text variant="label" color="textMuted">
          {value}
        </Text>
      ) : (
        value
      )}
      {onToggle ? (
        <Switch
          value={!!toggle}
          onValueChange={onToggle}
          disabled={toggleDisabled}
          accessibilityLabel={a11yLabel ?? label}
          trackColor={{ true: colors.accent }}
        />
      ) : onPress && !destructive ? (
        <Feather name={external ? "external-link" : "chevron-right"} size={external ? 14 : 16} color={colors.textMuted} />
      ) : null}
    </>
  );

  const frame = [styles.row, divider && styles.divider];
  if (onPress) {
    return (
      <Pressable
        accessibilityRole={role}
        accessibilityLabel={a11yLabel ?? label}
        onPress={onPress}
        style={({ pressed }) => [...frame, pressed && styles.pressed]}
      >
        {body}
      </Pressable>
    );
  }
  return <View style={frame}>{body}</View>;
}

const styles = StyleSheet.create({
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
  pressed: { backgroundColor: colors.background },
  text: { flex: 1, gap: 1 },
});
