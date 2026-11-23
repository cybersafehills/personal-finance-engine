import { router } from "expo-router";
import { useEffect } from "react";
import { View } from "react-native";
import { Button, Card, Text } from "@/components/ds";
import { GUIDE_REVISION } from "./definitions";
import { useGuides } from "./context";
export function GuidesHomeCard({ loaded }: { loaded: boolean }) {
  const guides = useGuides();
  const consider = guides?.considerWelcome;
  useEffect(() => { if (loaded) consider?.(); }, [loaded, consider]);
  if (!guides?.ready || (guides.state.progress.orientation?.status === "completed" && guides.state.progress.orientation.revision === GUIDE_REVISION)) return null;
  return <Card style={{ padding: 16, gap: 8 }}>
    <Text variant="bodyStrong">A good place to start</Text>
    <Text variant="label" color="textMuted">Start with three essentials. Choose a short task guide whenever you need it.</Text>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      <Button label={guides.state.progress.orientation?.status === "paused" ? "Resume introduction" : "Show essentials"} onPress={() => guides.start("orientation")}/>
      <Button label="All guides" variant="ghost" onPress={() => router.push("/guides")}/>
    </View>
  </Card>;
}
