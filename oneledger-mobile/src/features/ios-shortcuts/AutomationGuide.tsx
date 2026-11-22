import { useState } from "react";
import { Linking, Platform, View } from "react-native";
import { Button, Card, Text } from "@/components/ds";
import { useTheme } from "@/theme/ThemeProvider";

const APPLE_GUIDE = "https://support.apple.com/guide/shortcuts/add-automations-apdfbdbd7123/10.0/ios/27";
const modern = [
  { title: "Open the installed shortcut", detail: "In Shortcuts, open the installed OneLedger Capture shortcut. Tap Edit → Automation → Message.", highlight: "Use the installed shortcut", help: "If you are in a blank “New Shortcut”, go back to the library. Add the trigger to OneLedger Capture itself; its recording actions are already built." },
  { title: "Keep one Message condition", detail: "Tap the blue Sender label at the far left and change it to Message. Set contains to RWF. Keep only that one condition.", highlight: "Message  contains  RWF", help: "Seeing “Configure Sender”? Tap the blue Sender label at the far left, change it to Message, and enter RWF. If you now have two Message rows, remove the extra row with its minus button. You should have one Message contains RWF condition." },
  { title: "Allow background recording", detail: "Expand the arrow beside “When I receive a message”. Keep Automation on and Confirm Before Run off. In Edit → Info → Privacy, allow running when locked. Use the back arrow to save, then return here.", highlight: "Automation ON · Confirm Before Run OFF", help: "In Edit → Info → Privacy, enable Allow Running When Locked. Return with the top-left back arrow to save. If a Done button appears, tap it. Then return to OneLedger and test the connection. There is no Run Immediately screen in this layout." },
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
    try { await Linking.openURL(isModern ? "shortcuts://open-shortcut?name=OneLedger%20Capture" : "shortcuts://"); }
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
      <Button label={isModern ? "Open OneLedger Capture" : "Open Shortcuts"} variant="secondary" onPress={() => void openShortcut()} />
      {openError ? <Text accessibilityRole="alert" color="attention">Couldn’t open Shortcuts. Open it from your Home Screen and choose OneLedger Capture.</Text> : null}
    </Card>
    <View style={{ flexDirection: "row", gap: 10 }}>
      {index > 0 ? <Button label="Previous" variant="ghost" onPress={() => move(index - 1)} /> : null}
      <View style={{ flex: 1 }}><Button fullWidth label={index === steps.length - 1 ? "I’ve saved the trigger" : "Next instruction"} onPress={() => index === steps.length - 1 ? onNext() : move(index + 1)} /></View>
    </View>
    <Button label="Apple’s setup guide" variant="ghost" onPress={() => void Linking.openURL(APPLE_GUIDE)} />
  </>;
}
