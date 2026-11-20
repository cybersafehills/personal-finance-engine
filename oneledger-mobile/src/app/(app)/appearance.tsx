import Feather from "@expo/vector-icons/Feather";
import { View , StyleSheet } from "react-native";

import { Card, ListGroup, ListRow, Screen, ScreenHeader, Text } from "@/components/ds";
import { THEME_PREFERENCES } from "@/theme/preference";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";
import { radii, space } from "@/theme/tokens";

// Appearance: Automatic (follows the phone, including its automatic switch at
// night), Light or Dark. Kept on this phone. A small preview shows what is drawn now.
export default function Appearance() {
  const { preference, setPreference, scheme, colors } = useTheme();
  const styles = useStyles();
  const tick = <Feather name="check" size={16} color={colors.accent} />;

  return (
    <Screen>
      <ScreenHeader title="Appearance" subtitle="Choose how OneLedger looks on this phone" />
      <ListGroup title="Theme" footer="Automatic follows your phone's own Light / Dark setting, including when it switches at night.">
        {THEME_PREFERENCES.map((option) => (
          <ListRow
            key={option.id}
            label={option.label}
            hint={option.description}
            value={preference === option.id ? tick : undefined}
            a11yLabel={`${option.label}${preference === option.id ? ", selected" : ""}`}
            onPress={() => setPreference(option.id)}
          />
        ))}
      </ListGroup>

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
    </Screen>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    preview: { gap: space[2] },
    swatches: { flexDirection: "row", gap: space[2] },
    swatch: { width: 28, height: 28, borderRadius: radii.pill, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: colors.borderStrong },
  }),
);
