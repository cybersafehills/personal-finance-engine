import { StyleSheet, View, type ViewProps } from "react-native";

import { radii, space } from "@/theme/tokens";
import { makeStyles } from "@/theme/ThemeProvider";

/** Surface container: white, subtle border, card radius. No shadow. */
export function Card({ style, ...rest }: ViewProps) {
  const styles = useStyles();
  return <View {...rest} style={[styles.card, style]} />;
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.borderSubtle,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderRadius: radii.card,
    borderCurve: "continuous",
    paddingHorizontal: space[4],
    paddingVertical: space[3],
  },
}));
