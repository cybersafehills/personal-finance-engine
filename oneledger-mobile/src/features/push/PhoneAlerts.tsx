import { useState } from "react";

import { MenuGroup, MenuRow } from "@/features/settings/MenuUI";
import { useQuery } from "@/hooks/useQuery";

import { disablePush, enablePush, isPushEnabled, pushSupported } from "./push";

/** Device permissions are requested only after the person enables this switch. */
export function PhoneAlerts() {
  const { data, error, refresh } = useQuery(isPushEnabled);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  async function toggle(next: boolean) {
    if (busy || data === null) return;
    setBusy(true);
    setMessage(null);
    try {
      if (next) {
        const result = await enablePush();
        if (!result.ok) setMessage(result.message);
      } else await disablePush();
      refresh();
    } catch { setMessage("Couldn't update phone alerts. Please try again."); }
    finally { setBusy(false); }
  }
  return <MenuGroup title="On this phone" footer={message ?? error ?? (pushSupported ? "Receive notifications on this phone. Your in-app inbox stays available when alerts are off." : "Phone alerts need the app installed on a real phone.")}>
    <MenuRow icon="bell" label="Phone alerts" toggle={!!data} onToggle={toggle} toggleDisabled={!pushSupported || busy || data === null} />
  </MenuGroup>;
}
