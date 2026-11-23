import { useEffect, useState } from "react";
import { View } from "react-native";
import { Button, Card, Text } from "@/components/ds";
import { useGuides } from "./context";
import type { GuideId } from "./model";
/** One non-blocking invitation per session, only after the real data is ready. */
export function GuideSuggestion({ id, enabled = true }: { id: GuideId; enabled?: boolean }) {
  const guides = useGuides();
  const [offered, setOffered] = useState(false);
  const claim = guides?.claimSuggestion;
  const ready = guides?.ready && !guides.active;
  useEffect(() => { if (!enabled || !ready || !claim) return; const timer = setTimeout(() => setOffered(claim(id)), 0); return () => clearTimeout(timer); }, [enabled, ready, claim, id]);
  if (!guides || !ready || !enabled || !offered || guides.state.progress[id] || guides.state.dismissed.includes(id)) return null;
  const guide = guides.definitions.find(g => g.id === id)!;
  return <Card style={{ padding: 14, gap: 6 }}>
    <Text variant="bodyStrong">{guide.title}</Text><Text variant="label" color="textMuted">{guide.description}. Want a quick pointer?</Text>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}><Button label="Show me" size="sm" onPress={() => guides.start(id)}/><Button label="Not now" size="sm" variant="ghost" onPress={() => guides.dismissSuggestion(id)}/></View>
  </Card>;
}
