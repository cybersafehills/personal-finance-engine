import { StyleSheet, View } from "react-native";

import { Text } from "@/components/ds";
import { makeStyles } from "@/theme/ThemeProvider";
import { radii, space } from "@/theme/tokens";

/**
 * Where a partner advert will sit on the outlook page: after the most important section, so it never
 * pushes the first thing you need to read off the screen, and clearly labelled and separate from
 * your figures (an advert must never look like advice about your money).
 *
 * PLACEHOLDER: shown in development builds only, so a fake advert can never reach customers. To go
 * live, add an "outlook" id to the partner placements (model.ts, the platform console and feed) and
 * render `<PartnerPlacement id="outlook" />` here instead.
 */
export function OutlookAdSlot() {
  const styles = useStyles();
  if (!__DEV__) return null;
  return (
    <View style={styles.slot} accessible accessibilityLabel="Advert space. Placeholder for a partner offer.">
      <View style={styles.tag}><Text variant="caption" color="textMuted" style={{ fontWeight: "700" }}>ADVERT</Text></View>
      <Text variant="bodyStrong" color="textSecondary">Advert space</Text>
      <Text variant="caption" color="textMuted">A partner offer can appear here. It is always labelled and kept apart from your own figures.</Text>
    </View>
  );
}

const useStyles = makeStyles((c) => StyleSheet.create({
  slot: { minHeight: 112, borderRadius: radii.card, borderWidth: 1.5, borderStyle: "dashed", borderColor: c.borderStrong, backgroundColor: c.surface, padding: space[4], gap: space[1], alignItems: "flex-start", justifyContent: "center" },
  tag: { borderWidth: 1, borderColor: c.borderStrong, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
}));
