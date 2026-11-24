import Feather from "@expo/vector-icons/Feather";
import { router } from "expo-router";
import { useEffect, useId, useState } from "react";
import { AccessibilityInfo, Animated, Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import Svg, { Circle, Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { Text } from "@/components/ds";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";
import { useGuides } from "@/features/guides/context";
import { usePartnerPreview } from "./PartnerPreviewProvider";
import { PartnerArtwork } from "./PartnerArtwork";
import { nextIndex, placementOffers, placementReason, sponsorLabel, type PartnerOffer, type PlacementId, type PlacementPosition } from "./model";

export function PartnerPreviewNotice() {
  const { mode } = usePartnerPreview();
  if (mode === "live") return null;
  return <Text variant="caption" color="textMuted">Design preview · fictional offers, not redeemable</Text>;
}
export function PartnerOfferCard({ offer, compact = false, variant = "banner", onDismiss }: { offer: PartnerOffer; compact?: boolean; variant?: "banner" | "tile"; onDismiss?: () => void }) {
  const id = `banner-${useId().replace(/:/g, "")}`;
  const { colors } = useTheme();
  const creative = {
    Connectivity: { start: colors.partnerConnectivityStart, end: colors.partnerConnectivityEnd },
    Learning: { start: colors.partnerLearningStart, end: colors.partnerLearningEnd },
    Banking: { start: colors.partnerBankingStart, end: colors.partnerBankingEnd },
  } as const;
  const palette = creative[offer.category];
  const styles = useStyles();
  const tile = variant === "tile";
  const { width, fontScale } = useWindowDimensions();
  const stacked = !tile && (width < 350 || fontScale >= 1.3);
  return <View style={[styles.card, { backgroundColor: palette.end }]} testID={`partner-${variant}`}>
    <Svg width="100%" height="100%" style={StyleSheet.absoluteFill} accessible={false} pointerEvents="none">
      <Defs><LinearGradient id={id} x1="0" y1="0" x2="1" y2="0.8"><Stop stopColor={palette.start}/><Stop offset="0.55" stopColor={palette.start}/><Stop offset="1" stopColor={palette.end}/></LinearGradient></Defs>
      <Rect width="100%" height="100%" fill={`url(#${id})`}/>
      <Circle cx="98%" cy="48%" r={110} fill={colors.onSolid} opacity={0.045}/>
      <Circle cx="96%" cy="48%" r={77} fill={colors.onSolid} opacity={0.035}/>
    </Svg>
    <View style={styles.header}>
      <View style={styles.brand}><Text variant="caption" style={styles.disclosure}>{sponsorLabel(offer)}</Text><Text variant="label" style={styles.white}>{offer.brand}</Text></View>
      {onDismiss ? <Pressable accessibilityRole="button" accessibilityLabel="Dismiss sponsored content for this session" onPress={onDismiss} style={({ pressed }) => [styles.close, { opacity: pressed ? 0.6 : 1 }]}><Feather name="x" size={18} color={colors.onSolid}/></Pressable> : null}
    </View>
    <View pointerEvents="none" style={tile ? styles.tileArt : stacked ? styles.stackedArt : styles.art}><PartnerArtwork category={offer.category} size={tile ? 92 : 118}/></View>
    <View style={[tile ? styles.tileCopy : styles.copy, stacked && { paddingRight: 0 }]}>
      <Text variant="heading" style={[styles.headline, compact && { fontSize: 19, lineHeight: 25 }, tile && { fontSize: 18, lineHeight: 24 }]}>{offer.title}</Text>
      <Text variant="label" style={styles.benefit}>{offer.benefit}</Text>
    </View>
    <Pressable accessibilityRole="button" accessibilityLabel="View offer" accessibilityHint={`View ${offer.brand} eligibility and terms`} onPress={() => router.push({ pathname: "/partner-offer/[id]", params: { id: offer.id } })} style={({ pressed }) => [styles.cta, { opacity: pressed ? 0.8 : 1 }]}>
      <Text variant="label" style={{ color: colors.homeGradientStart, fontWeight: "600" }}>View offer</Text><Feather name="arrow-up-right" size={16} color={colors.homeGradientStart}/>
    </Pressable>
  </View>;
}
function usePalette(category: PartnerOffer["category"]) {
  const { colors } = useTheme();
  const palettes: Record<PartnerOffer["category"], readonly [string, string]> = { Connectivity: [colors.partnerConnectivityStart, colors.partnerConnectivityEnd], Learning: [colors.partnerLearningStart, colors.partnerLearningEnd], Banking: [colors.partnerBankingStart, colors.partnerBankingEnd] };
  return palettes[category];
}
function Backdrop({ palette, rings = true }: { palette: readonly [string, string]; rings?: boolean }) {
  const id = `bd-${useId().replace(/:/g, "")}`;
  const { colors } = useTheme();
  return <Svg width="100%" height="100%" style={StyleSheet.absoluteFill} accessible={false} pointerEvents="none">
    <Defs><LinearGradient id={id} x1="0" y1="0" x2="1" y2="0.9"><Stop stopColor={palette[0]}/><Stop offset="0.5" stopColor={palette[0]}/><Stop offset="1" stopColor={palette[1]}/></LinearGradient></Defs>
    <Rect width="100%" height="100%" fill={`url(#${id})`}/>
    {rings ? <><Circle cx="92%" cy="50%" r={96} fill={colors.onSolid} opacity={0.045}/><Circle cx="90%" cy="50%" r={64} fill={colors.onSolid} opacity={0.035}/></> : null}
  </Svg>;
}
const openOffer = (offer: PartnerOffer) => router.push({ pathname: "/partner-offer/[id]", params: { id: offer.id } });

/** Medium-widget proportions (about 2.1 : 1). The main banner. The whole banner opens the offer. */
export function PartnerWideCard({ offer, onDismiss }: { offer: PartnerOffer; onDismiss?: () => void }) {
  const { colors } = useTheme();
  const palette = usePalette(offer.category);
  const styles = useStyles();
  return <Pressable testID="partner-wide" accessibilityRole="button" accessibilityLabel="View offer" accessibilityHint={`Sponsored. View ${offer.brand} eligibility and terms`} onPress={() => openOffer(offer)} style={({ pressed }) => [styles.wide, { backgroundColor: palette[1], opacity: pressed ? 0.92 : 1 }]}>
    <Backdrop palette={palette}/>
    <View pointerEvents="none" style={styles.wideArt}><PartnerArtwork category={offer.category} size={104}/></View>
    <View style={styles.wideCopy}>
      <Text variant="caption" style={styles.disclosure} numberOfLines={1}>{sponsorLabel(offer)} · {offer.brand}</Text>
      <Text variant="heading" numberOfLines={3} style={styles.wideHeadline}>{offer.title}</Text>
      <View style={styles.wideCta}><Text variant="label" style={{ color: colors.homeGradientStart, fontWeight: "600", fontSize: 13 }}>View offer</Text><Feather name="arrow-up-right" size={14} color={colors.homeGradientStart}/></View>
    </View>
    {onDismiss ? <Pressable accessibilityRole="button" accessibilityLabel="Dismiss sponsored content for this session" onPress={onDismiss} hitSlop={6} style={({ pressed }) => [styles.wideClose, { opacity: pressed ? 0.6 : 1 }]}><Feather name="x" size={16} color={colors.onSolid}/></Pressable> : null}
  </Pressable>;
}
/** Small-widget proportions (1 : 1). Shown as a pair, each half the width. The whole card opens the offer. */
export function PartnerSquareCard({ offer }: { offer: PartnerOffer }) {
  const { colors } = useTheme();
  const palette = usePalette(offer.category);
  const styles = useStyles();
  return <Pressable testID="partner-square" accessibilityRole="button" accessibilityLabel="View offer" accessibilityHint={`Sponsored. View ${offer.brand} eligibility and terms`} onPress={() => openOffer(offer)} style={({ pressed }) => [styles.square, { backgroundColor: palette[1], opacity: pressed ? 0.92 : 1 }]}>
    <Backdrop palette={palette} rings={false}/>
    <View pointerEvents="none" style={styles.squareArt}><PartnerArtwork category={offer.category} size={72}/></View>
    <Text variant="caption" style={styles.disclosure} numberOfLines={1}>{sponsorLabel(offer)}</Text>
    <View style={{ flex: 1 }}/>
    <Text variant="label" numberOfLines={3} style={styles.squareHeadline}>{offer.title}</Text>
    <Text variant="caption" numberOfLines={1} style={styles.disclosure}>{offer.brand}</Text>
  </Pressable>;
}
export function PartnerOfferBar({ offer, onDismiss }: { offer: PartnerOffer; onDismiss?: () => void }) {
  const id = `bar-${useId().replace(/:/g, "")}`;
  const { colors } = useTheme();
  const palette = { Connectivity: [colors.partnerConnectivityStart, colors.partnerConnectivityEnd], Learning: [colors.partnerLearningStart, colors.partnerLearningEnd], Banking: [colors.partnerBankingStart, colors.partnerBankingEnd] }[offer.category];
  const styles = useStyles();
  return <View style={{ position: "relative" }}><Pressable testID="partner-bar" accessibilityRole="button" accessibilityLabel="View offer" accessibilityHint={`Sponsored. View ${offer.brand} eligibility and terms`} onPress={() => router.push({ pathname: "/partner-offer/[id]", params: { id: offer.id } })} style={({ pressed }) => [styles.bar, { backgroundColor: palette[1], opacity: pressed ? 0.85 : 1 }]}>
    <Svg width="100%" height="100%" style={StyleSheet.absoluteFill} accessible={false} pointerEvents="none">
      <Defs><LinearGradient id={id} x1="0" y1="0" x2="1" y2="0.4"><Stop stopColor={palette[0]}/><Stop offset="0.6" stopColor={palette[0]}/><Stop offset="1" stopColor={palette[1]}/></LinearGradient></Defs>
      <Rect width="100%" height="100%" fill={`url(#${id})`}/>
    </Svg>
    <View pointerEvents="none" style={{ marginVertical: -6 }}><PartnerArtwork category={offer.category} size={52}/></View>
    <View style={{ flex: 1, gap: 1 }}><Text variant="caption" style={styles.disclosure}>{sponsorLabel(offer)} · {offer.brand}</Text><Text variant="label" numberOfLines={1} style={[styles.white, { fontWeight: "600" }]}>{offer.title}</Text></View>
    <Feather name="arrow-up-right" size={18} color={colors.onSolid} style={onDismiss ? { marginRight: 30 } : undefined}/>
  </Pressable>
  {onDismiss ? <Pressable accessibilityRole="button" accessibilityLabel="Dismiss sponsored content for this session" onPress={onDismiss} hitSlop={8} style={({ pressed }) => [styles.barClose, { opacity: pressed ? 0.6 : 1 }]}><Feather name="x" size={15} color={colors.onSolid}/></Pressable> : null}
  </View>;
}
/**
 * One placement, driven by Partner Placement Settings: static card or auto-rotating carousel.
 * Rotation pauses while `paused` (typing/submitting), when the user prefers reduced motion, and on the last creative if not looping.
 */
export function PartnerPlacement({ id, ready = true, paused = false, blockedBy = null, slot }: { id: PlacementId; ready?: boolean; paused?: boolean; blockedBy?: string | null; slot?: PlacementPosition }) {
  const { state, today, dismissPlacement, canDismiss, mode, catalog } = usePartnerPreview();
  const dismiss = canDismiss ? () => dismissPlacement(id) : undefined;
  const guides = useGuides();
  const { colors } = useTheme();
  const styles = useStyles();
  const config = state.placements[id];
  const offers = placementOffers(state, id, today, catalog);
  const count = offers.length;
  const [index, setIndex] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [fade] = useState(() => new Animated.Value(1));
  useEffect(() => { void AccessibilityInfo.isReduceMotionEnabled?.().then(setReduceMotion).catch(() => {}); }, []);
  const rotates = config.mode === "carousel" && count > 1 && !paused && !reduceMotion;
  const current = Math.min(index, Math.max(count - 1, 0));
  useEffect(() => {
    if (!rotates) return;
    const timer = setTimeout(() => {
      Animated.timing(fade, { toValue: 0, duration: 160, useNativeDriver: true }).start(() => {
        setIndex(nextIndex(current, count, config.loop));
        Animated.timing(fade, { toValue: 1, duration: 220, useNativeDriver: true }).start();
      });
    }, config.intervalSec * 1000);
    return () => clearTimeout(timer);
  }, [rotates, current, count, config.loop, config.intervalSec, fade]);
  // A screen with a top and a bottom slot shows the placement only where the platform put it.
  if (slot && config.position !== slot) return null;
  // Customers get a live placement only from the platform; the "why is nothing here" notes are for design review only.
  if (mode === "off") return __DEV__ && id === "home" ? <Text variant="caption" color="textMuted" testID="partner-home-off">Sponsored content is off. Open More → Partner placement preview to start the design preview.</Text> : null;
  // Design-preview aid: when the preview is on, never fail silently; say why nothing is shown.
  const why = guides?.active ? "A guide is open" : !count ? (placementReason(state, id, today) ?? "No eligible example offer matches your language, interests and hidden brands") : !ready ? (blockedBy ?? "Essential content has not loaded yet") : null;
  if (why) return mode === "preview" && config.enabled ? <View testID={`partner-${id}-waiting`} style={{ gap: 2, padding: 12, borderRadius: 14, borderWidth: 1, borderStyle: "dashed", borderColor: colors.borderStrong }}><Text variant="caption" color="textMuted">Sponsored preview is waiting</Text><Text variant="caption" color="textMuted">{why}. Real placements stay hidden in this state.</Text></View> : null;
  const format = config.format;
  const first = offers[current];
  const second = offers[(current + 1) % count];
  // "square" is a pair when there are two creatives to show; a lone creative (or "half") is one half-width square.
  const pair = format === "square" && count > 1;
  const single = format === "half" || (format === "square" && count <= 1);
  const dots = config.mode === "carousel" && count > 1 ? <View style={styles.dots} accessibilityLabel={`Offer ${current + 1} of ${count}`}>{offers.map((offer, i) => <Pressable key={offer.id} accessibilityRole="button" accessibilityLabel={`Show offer ${i + 1} of ${count}`} hitSlop={10} onPress={() => setIndex(i)} style={[styles.dot, { backgroundColor: i === current ? colors.accent : colors.borderStrong, width: i === current ? 18 : 6 }]}/>)}</View> : null;
  return <View testID={id === "home" ? "partner-home-placement" : `partner-${id}-placement`} style={{ gap: 6 }}>
    {format === "bar" ? null : <PartnerPreviewNotice/>}
    {dismiss && (single || pair) ? <Pressable accessibilityRole="button" accessibilityLabel="Dismiss sponsored content for this session" onPress={dismiss} hitSlop={8} style={{ alignSelf: "flex-end", minHeight: 28, justifyContent: "center", paddingHorizontal: 6 }}><Text variant="caption" color="textMuted">Dismiss for this session</Text></Pressable> : null}
    <Animated.View style={{ opacity: fade }}>
      {format === "bar" ? <PartnerOfferBar offer={first} onDismiss={dismiss}/>
        : format === "tall" ? <PartnerOfferCard offer={first} compact onDismiss={dismiss}/>
        : single ? <View style={{ flexDirection: "row" }}><View style={{ width: "50%", paddingRight: 5 }}><PartnerSquareCard offer={first}/></View></View>
        : pair ? <View style={{ flexDirection: "row", gap: 10 }}><View style={{ flex: 1 }}><PartnerSquareCard offer={first}/></View><View style={{ flex: 1 }}><PartnerSquareCard offer={second}/></View></View>
        : <PartnerWideCard offer={first} onDismiss={dismiss}/>}
    </Animated.View>
    {dots}
  </View>;
}
export function PartnerHomePlacement({ ready, blockedBy }: { ready: boolean; blockedBy?: string | null }) { return <PartnerPlacement id="home" ready={ready} blockedBy={blockedBy}/>; }
const useStyles = makeStyles(colors => StyleSheet.create({
  card: { borderRadius: 24, borderCurve: "continuous", overflow: "hidden", padding: 20, gap: 16, flexGrow: 1 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 8, zIndex: 1 },
  brand: { flex: 1, gap: 3 },
  white: { color: colors.onSolid, fontSize: 13, lineHeight: 18 },
  disclosure: { color: colors.partnerOnMuted, fontSize: 11, lineHeight: 16 },
  close: { width: 44, height: 44, marginTop: -10, marginRight: -10, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  art: { position: "absolute", right: -5, top: 83 },
  tileArt: { position: "absolute", right: 3, top: 78 },
  stackedArt: { alignSelf: "flex-end", marginVertical: -8 },
  copy: { paddingRight: 88, gap: 8 },
  tileCopy: { paddingTop: 102, gap: 8 },
  headline: { color: colors.onSolid, fontSize: 21, lineHeight: 27 },
  benefit: { color: colors.partnerOnMuted, fontSize: 13, lineHeight: 19 },
  wide: { aspectRatio: 2.14, borderRadius: 22, borderCurve: "continuous", overflow: "hidden", padding: 16, flexDirection: "row" },
  wideArt: { position: "absolute", right: 6, bottom: 10 },
  wideCopy: { flex: 1, maxWidth: "66%", justifyContent: "space-between", gap: 6 },
  wideHeadline: { color: colors.onSolid, fontSize: 18, lineHeight: 23 },
  wideCta: { alignSelf: "flex-start", backgroundColor: colors.onSolid, borderRadius: 16, height: 32, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 5 },
  wideClose: { position: "absolute", top: 6, right: 6, width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.18)" },
  square: { aspectRatio: 1, borderRadius: 22, borderCurve: "continuous", overflow: "hidden", padding: 14 },
  squareArt: { position: "absolute", right: 2, top: 18 },
  squareHeadline: { color: colors.onSolid, fontSize: 14, lineHeight: 18, fontWeight: "600" },
  barClose: { position: "absolute", right: 8, top: "50%", marginTop: -14, width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.18)" },
  bar: { borderRadius: 18, borderCurve: "continuous", overflow: "hidden", minHeight: 56, paddingHorizontal: 14, paddingVertical: 8, flexDirection: "row", alignItems: "center", gap: 10 },
  dots: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 5, minHeight: 14 },
  dot: { height: 6, borderRadius: 3 },
  cta: { alignSelf: "flex-start", backgroundColor: colors.onSolid, borderRadius: 22, minHeight: 44, paddingHorizontal: 15, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
}));
