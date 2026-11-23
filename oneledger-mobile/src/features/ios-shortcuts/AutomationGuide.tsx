import { useState } from "react";
import { Linking, Platform, View } from "react-native";
import { Button, Card, Text } from "@/components/ds";
import { useTheme } from "@/theme/ThemeProvider";

const APPLE_GUIDE = "https://support.apple.com/guide/shortcuts/add-automations-apdfbdbd7123/10.0/ios/27";
type GuideStep = { title: string; highlight: string; actions: string[]; warning?: string; help: string };
const modern: GuideStep[] = [
  { title: "Open your Message automation", highlight: "Work in your new automation, not in Capture",
    actions: ["Open **Shortcuts**, then **Automation**.", "Open the new shortcut where you added **Message contains RWF**.", "If you have not made one, tap **+** and choose **Message**."],
    help: "OneLedger Capture is already installed. This new automation tells it when to start. Keep only one enabled automation for these messages. If you attached Message directly inside Capture, do not add a Run Shortcut action that calls Capture itself." },
  { title: "Clear the Sender warning", highlight: "Message contains RWF",
    warning: "Stop if you see ‘Configure Sender’. The automation cannot start while that warning is there.",
    actions: ["Look for the unfinished row **Sender is Sender**.", "Tap the first **Sender** label (on the left). If it offers **Message**, choose it and set **contains RWF**.", "Keep one **Message contains RWF** row. Remove the extra Message row using **−**."],
    help: "If your screen will not let you change that first label, fill in Sender with the sender of your actual MoMo message instead. Your screenshot shows M-Money. Keep Message contains RWF too. Both conditions must match. Do not continue while Configure Sender is still showing." },
  { title: "Choose the recording shortcut", highlight: "Run → OneLedger Capture",
    actions: ["Tap **Search** at the bottom of the editor. Search for **Run Shortcut** and tap that action.", "In the new **Run** box below your Message rule, tap the blue **Shortcut** name.", "Choose **OneLedger Capture** from the list. Do not choose the separate shortcut named **Run Shortcut**, or **Ask Each Time**."],
    help: "You are choosing a shortcut from a list, not pasting a website link. The finished action should read Run OneLedger Capture. The play triangle tests actions manually; it does not enable an unfinished Message rule." },
  { title: "Pass the message automatically", highlight: "Input → Shortcut Input → message text",
    warning: "A ‘Text’ typing box is not part of normal recording. Cancel it; do not enter RWF, a link, or your connection details.",
    actions: ["Tap the **>** arrow in the **Run OneLedger Capture** box to show **Input**.", "Tap **Input**, then **Select Variable** above the keyboard. Choose the incoming **Message** or **Shortcut Input**. If no variable choices appear, touch and hold Input.", "If the selected Message offers details, choose its **Content** or **Text**. The input must be the received message, not **Ask Each Time**."],
    help: "RWF is only the matching rule. Capture needs the whole message with the amount, date and balance. Do not use Clipboard, a fixed Text box, a file, or the output of another action. Pressing play without an incoming message does not test automatic forwarding. Use OneLedger’s connection test instead." },
  { title: "Save automatic recording", highlight: "Automation ON · Confirm Before Run OFF",
    actions: ["Expand the arrow beside **When I receive a message**.", "Set **Automation** to **ON** and **Confirm Before Run** to **OFF**.", "Use the top-left **back arrow** to save. Return to OneLedger."],
    help: "If Shortcuts offers Allow Running When Locked in its Info/Privacy settings, enable it. If that control is not on your screen, skip it. You do not need to find an Edit menu that is not there. Approve the first-run permissions only for the OneLedger shortcut and api.oneledger.me." },
  { title: "Check two separate things", highlight: "Connection test first · incoming message next",
    actions: ["In OneLedger, tap **Test connection without a payment**. Wait for **Connection test received**.", "Leave your Message automation on. Wait for your next normal incoming MoMo message; you do not need to make an extra payment.", "Check OneLedger for **New message received** and look for the transaction. If only the test passes, review **Sender** and the Run action’s **Input**."],
    help: "A connection test checks the internet connection and device key. Only a new incoming message tests the Message rule. Old messages are not picked up automatically. Receiving a message and finishing transaction processing are separate checks." },
];
const classic: GuideStep[] = [
  { title: "Create a Message automation", highlight: "Automation → + → Message",
    actions: ["Open **Shortcuts** and tap **Automation**.", "Tap **+**, then choose **Message**."],
    help: "Use this layout for iOS 17–26. If your screen has a Message rule inside the shortcut editor, use the newer-layout guide instead." },
  { title: "Match your MoMo messages", highlight: "Message Contains → RWF",
    actions: ["Tap **Message Contains** and type **RWF** without quotes.", "Leave **Sender** empty only if your screen allows it without a warning."],
    help: "If Sender is required, select the sender from a real MoMo message. Both filters must match. Never leave a Configure Sender warning unfinished." },
  { title: "Run without confirmation", highlight: "Run Immediately",
    actions: ["Choose **Run Immediately**, then **Next**.", "If you see **Ask Before Running** instead, turn it **OFF**, then confirm **Don’t Ask**."],
    help: "Automatic Message recording without confirmation requires iOS 17 or newer. Turn Notify When Run off if offered. Earlier iOS versions need manual confirmation and are not supported for unattended recording." },
  { title: "Choose OneLedger Capture", highlight: "Run → OneLedger Capture · Input → Shortcut Input",
    actions: ["Choose **OneLedger Capture** from the shortcut list.", "If you see an action editor, search for **Run Shortcut**, add it, then select **OneLedger Capture**.", "Expand its arrow. Set **Input** to the incoming **Message / Shortcut Input**, not **Ask Each Time**. Save with **Done**."],
    warning: "If a Text prompt asks you to type, cancel it. The automation must pass the received message for you.",
    help: "The input must contain the whole received message, not RWF or Clipboard. Return to OneLedger, run the connection test, then wait for a normal incoming MoMo message. A test alone does not confirm automatic recording." },
];

/** Bold only the exact controls a person needs to find in Apple’s screen. */
function Instruction({ value }: { value: string }) {
  return <Text>{value.split(/(\*\*.*?\*\*)/g).map((part, i) => part.startsWith("**")
    ? <Text key={i} variant="bodyStrong">{part.slice(2, -2)}</Text> : part)}</Text>;
}

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
      <View style={{ gap: 14 }}>
        {current.actions.map((value, i) => <View key={value} style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
          <Text variant="bodyStrong" color="accent">{i + 1}.</Text>
          <View style={{ flex: 1 }}><Instruction value={value} /></View>
        </View>)}
      </View>
      {current.warning ? <View style={{ borderLeftWidth: 3, borderLeftColor: colors.attention, paddingLeft: 12 }}><Text accessibilityRole="alert" variant="bodyStrong" color="attention">{current.warning}</Text></View> : null}
      <Button label={help ? "Hide help" : "I can’t find this"} variant="ghost" onPress={() => setHelp(!help)} />
      {help ? <Text color="textSecondary">{current.help}</Text> : null}
      <Button label="Open Shortcuts" variant="secondary" onPress={() => void openShortcut()} />
      {openError ? <Text accessibilityRole="alert" color="attention">Couldn’t open Shortcuts. Open it from your Home Screen, then open your Message automation.</Text> : null}
    </Card>
    <View style={{ flexDirection: "row", gap: 10 }}>
      {index > 0 ? <Button label="Previous" variant="ghost" onPress={() => move(index - 1)} /> : null}
      <View style={{ flex: 1 }}><Button fullWidth label={index === steps.length - 1 ? "I’ve saved the trigger" : "Next instruction"} onPress={() => index === steps.length - 1 ? onNext() : move(index + 1)} /></View>
    </View>
    <Button label="Apple’s setup guide" variant="ghost" onPress={() => void Linking.openURL(APPLE_GUIDE)} />
  </>;
}
