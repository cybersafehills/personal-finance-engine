import { StyleSheet, View } from "react-native";

import { Card, Text } from "@/components/ds";
import { MenuGroup, MenuRow, MenuScreen } from "@/features/settings/MenuUI";
import { THEME_PREFERENCES } from "@/theme/preference";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";
import { radii, space } from "@/theme/tokens";

// Appearance: Automatic (follows the phone, including its automatic switch at
// night), Light or Dark. Kept on this phone. A small preview shows what is drawn now.
export default function Appearance() {
  const { preference, setPreference, scheme, colors } = useTheme();
  const styles = useStyles();
  return (
    <MenuScreen title="Appearance" subtitle="Choose how OneLedger looks on this phone.">
      <MenuGroup title="Theme" footer="Automatic follows your phone's own Light / Dark setting, including when it switches at night.">
        {THEME_PREFERENCES.map((option) => (
          <MenuRow
            key={option.id}
            label={option.label}
            icon={option.id === "system" ? "monitor" : option.id === "dark" ? "moon" : "sun"}
            role="radio"
            selected={preference === option.id}
            a11yLabel={`${option.label}${preference === option.id ? ", selected" : ""}`}
            onPress={() => setPreference(option.id)}
          />
        ))}
      </MenuGroup>

      <Card style={styles.preview} accessibilityLabel={`Preview, showing the ${scheme} appearance`}>
        <Text variant="caption" color="textMuted">
          Now showing
        </Text>
        <Text variant="heading">{scheme === "dark" ? "Dark" : "Light"}</Text>
        <View style={styles.swatches}>
          <View style={[styles.swatch, { backgroundColor: colors.accentSolid }]} />
          <View style={[styles.swatch, { backgroundColor: colors.moneyPositiveSolid }]} />
          <View style={[styles.swatch, { backgroundColor: colors.moneyRequestSolid }]} />
          <View style={[styles.swatch, { backgroundColor: colors.ekashSolid }]} />
        </View>
      </Card>
    </MenuScreen>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    preview: { gap: space[2] },
    swatches: { flexDirection: "row", gap: space[2] },
    swatch: { width: 28, height: 28, borderRadius: radii.pill, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: colors.borderStrong },
  }),
);
