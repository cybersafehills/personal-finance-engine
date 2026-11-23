import { Platform, Pressable, View } from "react-native";
import { useState } from "react";
import { Button, Text, TextField } from "@/components/ds";
import { useGuides } from "@/features/guides/context";
import { GUIDE_GROUPS } from "@/features/guides/definitions";
import { MenuGroup, MenuRow, MenuScreen } from "@/features/settings/MenuUI";
import { useActiveSpace } from "@/features/spaces/ActiveSpaceProvider";
import { useNavigationChrome } from "@/components/shell/NavigationChromeContext";
import { captureSupported } from "@/features/capture/capture";
export default function Guides() {
  const guides = useGuides();
  const { spaces } = useActiveSpace();
  const { payOn } = useNavigationChrome();
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string[]>(["Start here"]);
  const term = query.trim().toLocaleLowerCase();
  const definitions = guides?.definitions.filter(guide => !term || `${guide.title} ${guide.description} ${guide.group}`.toLocaleLowerCase().includes(term)) ?? [];
  return <MenuScreen title="Guides & help" subtitle="What would you like to do? Each guide takes just a few steps.">
    <TextField compact label="Find a guide" placeholder="Search a task or feature" value={query} onChangeText={setQuery} autoCapitalize="none"/>
    {guides?.notice ? <Text variant="label" color="textMuted" accessibilityLiveRegion="polite">{guides.notice}</Text> : null}
    {!guides?.ready ? <Text color="textMuted">Loading your guides…</Text> : GUIDE_GROUPS.map(group => {
      const items = definitions.filter(guide => guide.group === group);
      if (!items.length) return null;
      const open = !!term || expanded.includes(group);
      return <View key={group} style={{gap:8}}>
        <Pressable accessibilityRole="button" accessibilityState={{expanded:open}} accessibilityLabel={group} onPress={() => setExpanded(previous => previous.includes(group) ? previous.filter(item => item !== group) : [...previous,group])} style={{minHeight:44,flexDirection:"row",alignItems:"center",justifyContent:"space-between"}}><Text variant="bodyStrong">{group}</Text><Text color="textMuted">{open ? "−" : "+"}</Text></Pressable>
        {open ? <MenuGroup>{items.map(guide => {
          const unavailable = ["pay","scan"].includes(guide.id) && !payOn ? "Pay is unavailable in this Space" : guide.id === "spaces" && spaces.length < 2 ? "Available when you join another Space" : guide.id === "recording" && !captureSupported && Platform.OS !== "ios" ? "Requires a supported phone" : null;
          const progress = guides.state.progress[guide.id];
          return <MenuRow key={guide.id} icon={guide.icon} label={guide.title} hint={unavailable ?? `${guide.steps.length} steps · ${guide.description}`} value={unavailable ? undefined : progress?.status === "completed" ? "Replay" : progress?.status === "paused" ? "Resume" : "Start"} onPress={unavailable ? undefined : () => guides.start(guide.id)}/>;
        })}</MenuGroup> : null}
      </View>;
    })}
    {guides?.ready && !definitions.length ? <Text color="textMuted">No guides match. Try “transaction”, “budget” or “statement”.</Text> : null}
    {guides?.ready ? <Button label="Replay the welcome" variant="ghost" onPress={guides.offerWelcome}/> : null}
  </MenuScreen>;
}
