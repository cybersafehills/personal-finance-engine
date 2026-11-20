import { useMemo } from "react";

import { ListGroup, ListRow, Screen, ScreenHeader } from "@/components/ds";
import { getPayConfigCache } from "@/features/pay/config-cache";
import { HOLD_ACTIONS, HOLD_DURATIONS, holdActionAvailable } from "@/features/pay/hold-action";
import { setHoldPrefs, useHoldPrefs } from "@/features/pay/hold-store";
import Feather from "@expo/vector-icons/Feather";
import { useTheme } from "@/theme/ThemeProvider";

// What holding the centre Pay button does, and for how long. A tap always opens
// the Pay menu. Only actions this account can use can be picked; the choice is
// kept on this phone.
export default function PayButtonSettings() {
  const { colors } = useTheme();
  const prefs = useHoldPrefs();
  const config = useMemo(() => getPayConfigCache(), []);
  const tick = <Feather name="check" size={16} color={colors.accent} />;

  return (
    <Screen>
      <ScreenHeader title="Pay button" subtitle="Tap opens Pay and Services. Hold jumps straight to the action you choose." />
      <ListGroup title="When I hold it" footer="Actions your account can't use yet are not offered.">
        {HOLD_ACTIONS.filter((a) => holdActionAvailable(a.id, config)).map((a) => (
          <ListRow
            key={a.id}
            role="button"
            label={a.label}
            hint={a.description}
            value={prefs.action === a.id ? tick : undefined}
            a11yLabel={`${a.label}${prefs.action === a.id ? ", selected" : ""}`}
            onPress={() => void setHoldPrefs({ action: a.id })}
          />
        ))}
      </ListGroup>
      {prefs.action !== "sheet" ? (
        <ListGroup title="How long to hold" footer="Shorter is quicker, but easier to trigger by accident.">
          {HOLD_DURATIONS.map((d) => (
            <ListRow
              key={d.ms}
              label={d.label}
              value={prefs.durationMs === d.ms ? tick : undefined}
              a11yLabel={`${d.label}${prefs.durationMs === d.ms ? ", selected" : ""}`}
              onPress={() => void setHoldPrefs({ durationMs: d.ms })}
            />
          ))}
        </ListGroup>
      ) : null}
    </Screen>
  );
}
