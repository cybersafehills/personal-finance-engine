import { useState } from "react";
import { View } from "react-native";
import { Card, Text } from "@/components/ds";
import { MenuGroup, MenuRow, MenuScreen } from "@/features/settings/MenuUI";
import { useLock } from "@/features/lock/LockProvider";
import { space } from "@/theme/tokens";

export default function Security() {
  const { available, enabled, setEnabled } = useLock();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  async function toggle(next: boolean) {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const changed = await setEnabled(next);
      if (!changed) setMessage("Couldn't confirm it's you, so nothing was changed.");
    } catch { setMessage("Couldn't update app lock. Please try again."); }
    finally { setBusy(false); }
  }
  return (
    <MenuScreen title="App lock">
      <Card style={{ gap: space[2] }}>
        <Text variant="title">Private, even on your phone</Text>
        <Text color="textMuted">Add a check when OneLedger opens.</Text>
      </Card>
      <MenuGroup title="On this phone" footer="Require your fingerprint, face or phone passcode when opening OneLedger, and after a minute away.">
        <MenuRow icon="lock" label="App lock" toggle={enabled} onToggle={toggle} toggleDisabled={!available || busy} />
      </MenuGroup>
      <View style={{ gap: space[3] }}>
        {!available ? <Text variant="label" color="attention">App lock needs a fingerprint, face or passcode set up on this phone. It isn&apos;t available in the web preview.</Text> : null}
        {message ? <Text variant="label" color="attention" accessibilityRole="alert">{message}</Text> : null}
        <Text variant="label" color="textMuted">Recording your MoMo messages keeps working while the app is locked.</Text>
      </View>
    </MenuScreen>
  );
}
