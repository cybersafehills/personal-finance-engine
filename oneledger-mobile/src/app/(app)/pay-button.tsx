import { useMemo } from "react";

import { MenuGroup, MenuRow, MenuScreen } from "@/features/settings/MenuUI";
import { getPayConfigCache } from "@/features/pay/config-cache";
import { HOLD_ACTIONS, HOLD_DURATIONS, holdActionAvailable } from "@/features/pay/hold-action";
import { setHoldPrefs, useHoldPrefs } from "@/features/pay/hold-store";

// What holding the centre Pay button does, and for how long. A tap always opens
// the Pay menu. Only actions this account can use can be picked; the choice is
// kept on this phone.
export default function PayButtonSettings() {
  const prefs = useHoldPrefs();
  const config = useMemo(() => getPayConfigCache(), []);

  return (
    <MenuScreen title="Pay button" subtitle="Tap opens Pay & Services. Hold jumps to your chosen action.">
      <MenuGroup title="When I hold it" footer="Actions your account can't use yet are not offered.">
        {HOLD_ACTIONS.filter((a) => holdActionAvailable(a.id, config)).map((a) => (
          <MenuRow
            key={a.id}
            role="radio"
            label={a.label}
            icon={a.id === "scan" ? "maximize" : a.id === "ussd" ? "hash" : "send"}
            selected={prefs.action === a.id}
            a11yLabel={`${a.label}${prefs.action === a.id ? ", selected" : ""}`}
            onPress={() => void setHoldPrefs({ action: a.id })}
          />
        ))}
      </MenuGroup>
      {prefs.action !== "sheet" ? (
        <MenuGroup title="How long to hold" footer="Shorter is quicker, but easier to trigger by accident.">
          {HOLD_DURATIONS.map((d) => (
            <MenuRow
              key={d.ms}
              label={d.label}
              role="radio"
              selected={prefs.durationMs === d.ms}
              a11yLabel={`${d.label}${prefs.durationMs === d.ms ? ", selected" : ""}`}
              onPress={() => void setHoldPrefs({ durationMs: d.ms })}
            />
          ))}
        </MenuGroup>
      ) : null}
    </MenuScreen>
  );
}
