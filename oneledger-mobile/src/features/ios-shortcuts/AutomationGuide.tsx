import { useState } from "react";
import { Linking, Platform, View } from "react-native";
import { Button, Card, Text } from "@/components/ds";
import { useTheme } from "@/theme/ThemeProvider";

const APPLE_GUIDE = "https://support.apple.com/guide/shortcuts/add-automations-apdfbdbd7123/10.0/ios/27";
const modern = [
  { title: "Open your Message automation", detail: "Open Shortcuts → Automation. Continue the “New Shortcut” where you added the Message trigger. If you have not created one, tap + and choose Message. This automation will run the OneLedger Capture shortcut you installed.", highlight: "Message automation → run OneLedger Capture", help: "You install only OneLedger Capture. The separate automation is the event that starts it when a message arrives. You do not need to edit OneLedger Capture’s recording actions. If you already attached a working Message trigger directly to OneLedger Capture, keep that approach and do not enable a second trigger." },
  { title: "Fix the unfinished Sender condition", detail: "Your screenshot still has “Sender is Sender” above “Message contains RWF”. Tap the first blue Sender label at the far left and change that condition to Message contains RWF. Remove the extra Message row with its minus button.", highlight: "One condition: Message contains RWF", help: "The warning “Configure Sender” means that first condition is incomplete. The RWF row underneath does not cancel it. If changing the first label is unavailable, configure Sender with the exact MoMo sender from a real message and keep Message contains RWF; both conditions must then match." },
  { title: "Add the recording action", detail: "Below the Message trigger, use the bottom Search field to find Run Shortcut. Add that action, tap its shortcut name and choose OneLedger Capture. Set its Input to the received Message from the trigger (Shortcut Input).", highlight: "Run Shortcut: OneLedger Capture · Input: received message", help: "The RWF condition is only a filter, not the message to send. Do not type RWF into the action’s Input. Expand Run Shortcut if Input is hidden, and select the trigger’s received message variable. A Message trigger with nothing below it cannot record anything. If your trigger is directly inside OneLedger Capture, its existing recording actions already serve this purpose; skip adding Run Shortcut there to avoid calling itself." },
  { title: "Save and test forwarding", detail: "Expand the arrow beside “When I receive a message”. Keep Automation on and Confirm Before Run off. Use the top-left back arrow to save. Return here and run the connection test before waiting for a real incoming MoMo message.", highlight: "Automation ON · Confirm Before Run OFF", help: "The circled ⓘ at the bottom of the shortcut editor is the Info button, between redo and Share in your screenshot. If it offers Privacy → Allow Running When Locked, enable it. If that option is absent, skip it; do not keep searching for an Edit menu. First-run file and api.oneledger.me prompts are separate permissions. A successful connection test still does not prove the Messages trigger runs." },
];
const classic = [
  { title: "Create a Message automation", detail: "In Shortcuts, tap Automation → + → Message.", highlight: "Automation → Message", help: "Use this guide for iOS 17–26. If your editor has a trigger inside the shortcut, switch to the iOS 27 guide." },
  { title: "Match your MoMo messages", detail: "Select Message Contains and enter RWF. A Sender filter is optional in this layout.", highlight: "Message Contains: RWF", help: "Use the exact letters RWF, with no quotes. This condition selects messages to forward. OneLedger then checks whether each message is supported." },
  { title: "Run without confirmation", detail: "Choose Run Immediately, then Next. If your version shows Ask Before Running instead, turn it off and confirm Don’t Ask.", highlight: "Run Immediately", help: "Message automation without confirmation requires iOS 17 or newer. Turn Notify When Run off if that option is available." },
  { title: "Choose OneLedger Capture", detail: "Choose OneLedger Capture. If you see an action editor instead, add Run Shortcut, choose OneLedger Capture, and pass Shortcut Input as its input. Save with Done.", highlight: "Run Shortcut → OneLedger Capture", help: "The input must be the incoming message, not Clipboard or a fixed sample. Return to OneLedger after saving." },
];

export function AutomationGuide({ onNext, majorVersion = Number.parseInt(String(Platform.Version), 10) }: { onNext(): void; majorVersion?: number }) {
  const { colors } = useTheme();
  const [isModern, setModern] = useState(majorVersion >= 27);
  const [index, setIndex] = useState(0);
  const [help, setHelp] = useState(false);
  const [openError, setOpenError] = useState(false);
  const steps = isModern ? modern : classic;
  const current = steps[index];
  async function openShortcut() {
    setOpenError(false);
    try { await Linking.openURL("shortcuts://"); }
    catch { setOpenError(true); }
  }
  function move(next: number) { setIndex(next); setHelp(false); }
  return <>
    <View style={{ flexDirection: "row", gap: 8 }}>
      <Button label="iOS 27" variant={isModern ? "secondary" : "ghost"} onPress={() => { setModern(true); move(0); }} />
      <Button label="iOS 17–26" variant={!isModern ? "secondary" : "ghost"} onPress={() => { setModern(false); move(0); }} />
    </View>
    <Card style={{ gap: 16 }}>
      <Text variant="caption" color="textMuted">{index + 1} of {steps.length} · In Apple Shortcuts</Text>
      <Text variant="heading">{current.title}</Text>
      <View style={{ padding: 14, borderRadius: 12, backgroundColor: colors.accentBg }}>
        <Text variant="bodyStrong" color="accent">{current.highlight}</Text>
      </View>
      <Text>{current.detail}</Text>
      <Button label={help ? "Hide help" : "I can’t find this"} variant="ghost" onPress={() => setHelp(!help)} />
      {help ? <Text color="textSecondary">{current.help}</Text> : null}
      <Button label="Open Shortcuts" variant="secondary" onPress={() => void openShortcut()} />
      {openError ? <Text accessibilityRole="alert" color="attention">Couldn’t open Shortcuts. Open it from your Home Screen and choose OneLedger Capture.</Text> : null}
    </Card>
    <View style={{ flexDirection: "row", gap: 10 }}>
      {index > 0 ? <Button label="Previous" variant="ghost" onPress={() => move(index - 1)} /> : null}
      <View style={{ flex: 1 }}><Button fullWidth label={index === steps.length - 1 ? "I’ve saved the trigger" : "Next instruction"} onPress={() => index === steps.length - 1 ? onNext() : move(index + 1)} /></View>
    </View>
    <Button label="Apple’s setup guide" variant="ghost" onPress={() => void Linking.openURL(APPLE_GUIDE)} />
  </>;
}
