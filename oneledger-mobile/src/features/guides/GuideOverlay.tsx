import Feather from "@expo/vector-icons/Feather";
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, useWindowDimensions, View, type ViewInstance } from "react-native";
import Svg, { Path } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, Text } from "@/components/ds";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";
import { coachPlacement, guidePanelLimits, type Rect } from "./model";

type Props = {
  mode: "welcome" | "complete" | "coach" | "missing" | "loading";
  title: string; body: string; label: string; action: string; step: number; total: number;
  visible?: boolean; onDismiss?: () => void; onShow?: () => void;
  target: Rect | null; onNext(): void; onBack(): void; onClose(): void; onGuides(): void;
};
export function GuideOverlay({ mode, title, body, label, action, step, total, target, onNext, onBack, onClose, visible = true, onDismiss, onShow }: Props) {
  const root = useRef<ViewInstance>(null);
  const styles = useStyles(), { colors } = useTheme(), window = useWindowDimensions(), insets = useSafeAreaInsets();
  const [height, setHeight] = useState(210), [origin, setOrigin] = useState({ x: 0, y: 0 });
  const viewport = { width: window.width, height: window.height, top: insets.top, bottom: insets.bottom };
  const limits = guidePanelLimits(viewport);
  const adjusted = target ? { ...target, x: target.x - origin.x, y: target.y - origin.y } : null;
  const placement = adjusted ? coachPlacement(adjusted, viewport, height) : null;
  const anchored = mode === "coach" && placement && placement.side !== "sheet";
  const left = placement?.left ?? Math.max(12, (window.width - limits.width) / 2);
  const top = placement?.top ?? Math.max(insets.top + 12, window.height - insets.bottom - Math.min(height, limits.maxHeight) - 12);
  const horizontal = anchored && ["left", "right"].includes(placement.side);
  useEffect(() => {
    if (visible && mode !== "loading") AccessibilityInfo.announceForAccessibility(`${title}. ${total ? `Step ${step + 1} of ${total}. ` : ""}${body}`);
  }, [title, body, mode, step, total, visible]);
  return <Modal transparent visible={visible} onDismiss={onDismiss} onShow={onShow} animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
    <View ref={root} style={styles.fill} onLayout={() => root.current?.measureInWindow((x, y) => setOrigin(old => old.x === x && old.y === y ? old : { x, y }))}>
      <Pressable accessible={false} style={StyleSheet.absoluteFill} onPress={onClose}/>
      <Svg accessible={false} pointerEvents="none" width={window.width} height={window.height} style={StyleSheet.absoluteFill}>
        <Path fillRule="evenodd" fillOpacity={mode === "loading" ? 0 : 0.24} fill={colors.guideScrim} d={`M0 0H${window.width}V${window.height}H0Z${anchored ? `M${placement.spot.x} ${placement.spot.y}v${placement.spot.height}h${placement.spot.width}v-${placement.spot.height}Z` : ""}`} />
      </Svg>
      {anchored ? <View pointerEvents="none" style={[styles.spot, { left: placement.spot.x, top: placement.spot.y, width: placement.spot.width, height: placement.spot.height }]} /> : null}
      <View accessibilityViewIsModal onAccessibilityEscape={onClose} testID="guide-dialog" onLayout={event => setHeight(event.nativeEvent.layout.height)} style={[styles.card, { maxHeight: limits.maxHeight, left, top, width: limits.width }]}>
        {anchored ? <View pointerEvents="none" style={[styles.pointer, horizontal ? {
          top: Math.max(18, Math.min(height - 24, placement.spot.y + placement.spot.height / 2 - top - 5)),
          ...(placement.side === "left" ? { right: -5 } : { left: -5 }),
        } : {
          left: Math.max(18, Math.min(limits.width - 24, placement.spot.x + placement.spot.width / 2 - left - 5)),
          ...(placement.side === "below" ? { top: -5 } : { bottom: -5 }),
        }]} /> : null}
        <View style={styles.heading}>
          <Text variant="caption" color="textMuted" style={styles.kicker}>{mode === "welcome" ? label : `${label} · ${step + 1}/${total}`}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={mode === "welcome" ? "Dismiss introduction" : "Close and pause guide"} onPress={onClose} style={styles.close}><Feather name="x" color={colors.textMuted} size={17}/></Pressable>
        </View>
        {mode === "loading" ? <View style={styles.loading}><ActivityIndicator size="small" color={colors.accent}/><Text variant="label" color="textMuted">Finding the next item…</Text></View> : <ScrollView style={{flexGrow:0,flexShrink:1}} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.copy}>
          <Text variant="heading" accessibilityRole="header" style={styles.title}>{title}</Text>
          <Text color="textSecondary" style={styles.body}>{body}</Text>
        </ScrollView>}
        <View style={styles.actions}>
          {mode === "welcome" ? <Button label="Not now" variant="ghost" size="sm" onPress={onClose}/> : step > 0 ? <Button label="Back" variant="ghost" size="sm" onPress={onBack}/> : <View/>}
          <Button label={mode === "loading" ? "Loading…" : action} variant="primary" size="sm" disabled={mode === "loading"} onPress={onNext}/>
        </View>
      </View>
    </View>
  </Modal>;
}
const useStyles = makeStyles(c => StyleSheet.create({
  fill: { flex: 1 },
  spot: { position: "absolute", borderWidth: 2, borderColor: c.accent, borderRadius: 10 },
  card: { position: "absolute", padding: 14, borderRadius: 16, backgroundColor: c.surface, borderWidth: 1, borderColor: c.borderSubtle, boxShadow: "0 6px 24px rgba(0,0,0,0.16)" },
  heading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 6, paddingBottom: 6 },
  kicker: { fontSize: 11, lineHeight: 16, flex: 1 },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center", marginTop: -12, marginBottom: -12, marginRight: -10 },
  copy: { gap: 6, paddingBottom: 8 },
  title: { fontSize: 17, lineHeight: 22 },
  body: { fontSize: 13, lineHeight: 19 },
  pointer: { position: "absolute", width: 10, height: 10, transform: [{ rotate: "45deg" }], backgroundColor: c.surface },
  actions: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, paddingTop: 6, minHeight: 44 },
  loading: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
}));
