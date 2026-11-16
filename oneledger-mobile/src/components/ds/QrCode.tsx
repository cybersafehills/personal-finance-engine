import { memo, useMemo } from "react";
import { View } from "react-native";

import { qrMatrix } from "@/lib/qr";
import { colors } from "@/theme/tokens";

const QUIET = 4; // modules of white border a scanner needs

/**
 * A QR code drawn from squares. Always dark-on-white (not themed) so every
 * scanner reads it. Exposed to screen readers as an image with `label`; the
 * same information must also be available as text next to it.
 */
function QrCodeBase({ value, size = 220, label }: { value: string; size?: number; label: string }) {
  const matrix = useMemo(() => qrMatrix(value), [value]);
  const total = matrix.length + QUIET * 2;
  const cell = size / total;
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
      style={{ width: size, height: size, backgroundColor: "#ffffff", alignSelf: "center" }}
    >
      {matrix.map((row, y) => (
        <View key={y} style={{ flexDirection: "row", position: "absolute", top: (y + QUIET) * cell, left: QUIET * cell }}>
          {row.map((dark, x) => (
            <View key={x} style={{ width: cell, height: cell, backgroundColor: dark ? colors.textPrimary : "#ffffff" }} />
          ))}
        </View>
      ))}
    </View>
  );
}

export const QrCode = memo(QrCodeBase);
